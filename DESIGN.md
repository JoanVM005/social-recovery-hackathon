# ANARKey — Community Social Recovery for EVM

## Design Document

> Adapted from: _"ANARKey: A New Approach to (Socially) Recover Keys"_ (ePrint 2025/551, Kate et al.)

---

## 1. Resumen del enfoque

El contrato `CommunitySocialRecovery` implementa un sistema de **recuperación social comunitaria** donde:

- Cada usuario registra una **identidad on-chain** (su dirección) junto con un conjunto de **guardianes** y un **threshold**.
- Para recuperar acceso, un número mínimo (`threshold`) de guardianes deben cooperar produciendo **aprobaciones verificables**.
- El resultado no es reconstruir una clave privada (imposible y innecesario en EVM), sino **rotar la dirección propietaria** (owner) de la identidad on-chain.
- Se ofrecen **dos alternativas** de recuperación:
  - **A) Firmas EIP-712 off-chain** (principal): los guardianes firman un mensaje tipado; un relayer envía las firmas en batch.
  - **B) Votación on-chain** (secundaria): cada guardián envía una transacción de aprobación.
- Un **timelock** opcional permite al propietario legítimo cancelar recuperaciones maliciosas antes de que se ejecuten.

---

## 2. Mapping from Paper to EVM Design

| Paper Concept | EVM Adaptation |
|---|---|
| **Guardian (party _j_)** | Una dirección Ethereum (`address`) registrada como guardián del usuario _i_. |
| **σ\_{i,j} = H(i, sk\_j)** | Firma ECDSA del guardián _j_ sobre datos EIP-712 tipados que incluyen `protectedAccount_i`, `proposedNewOwner`, `requestId`, `configNonce`, y `deadline`. La firma se **deriva de sk\_j**, se **liga a la identidad del usuario i**, y se **genera independientemente** — exactamente el rol funcional de σ\_{i,j}. |
| **Public recovery data (BUSS public points)** | `recoveryDataHash`: un `bytes32` commitment almacenado on-chain. Representa el hash keccak256 de cualquier dato público de configuración off-chain (puntos de polinomio, commitments de guardianes, etc.). Solo el commitment vive on-chain; los datos viven off-chain. |
| **Secret reconstruction** | **No existe on-chain.** El resultado del recovery es una **rotación de owner address**: `config.owner = proposedNewOwner`. No se reconstruye ninguna clave privada literal. |
| **Threshold recovery (t-of-n)** | `threshold` almacenado en `RecoveryConfig`. Se requieren ≥ t aprobaciones válidas de guardianes para ejecutar la recuperación. |
| **Malicious guardian** | Un guardián comprometido. Mitigado por: (1) el requisito de threshold (un solo guardián no basta), (2) el timelock que permite al owner real cancelar, (3) el `configNonce` que invalida requests cuando la config cambia. |
| **Domino effect** | Si un guardián sirve a muchos usuarios y es comprometido, la seguridad de todos se degrada. On-chain, esto se maneja limitando `MAX_GUARDIANS=32`. Off-chain, se recomienda monitorizar cuántas cuentas protege cada guardián. |
| **Adaptive corruption** | Modelada por: (1) timelock window para detectar y cancelar, (2) incremento de `configNonce` al rotar guardianes (invalida requests antiguos), (3) firma con deadline individual para limitar ventana de ataque. |

### Diferencia conceptual fundamental

> En el paper original, el objetivo es **reconstruir una secret key** a partir de las contribuciones (shares) de los guardianes.
>
> En Solidity/EVM, **no es posible ni deseable** reconstruir una clave privada on-chain. Lo realista es **recuperar control administrativo** sobre una cuenta o contrato, típicamente **cambiando la owner address** a una nueva dirección controlada por quien demuestra legitimidad a través de los guardianes.

---

## 3. Arquitectura del Sistema

### Contrato principal

```
CommunitySocialRecovery.sol (anarkey.sol)
├── Hereda: EIP712, ReentrancyGuard (OpenZeppelin)
├── Custom Errors (30+)
├── Events (8)
├── Structs (2: RecoveryConfig, RecoveryRequest)
├── Constants (7)
├── State Variables (6 mappings + 1 counter)
├── Modifiers (2: onlyConfigOwner, configActive)
├── Constructor (EIP712 domain init)
├── Configuration Functions
│   ├── configureRecovery()
│   ├── updateGuardians()
│   ├── updateRecoveryData()
│   └── deactivateRecovery()
├── Recovery Functions
│   ├── initiateRecovery()
│   ├── submitSignatureApprovals()  [Alt A]
│   ├── approveRecovery()           [Alt B]
│   ├── finalizeRecovery()
│   └── cancelRecovery()
├── View Functions (7)
└── Internal Functions (7)
```

### Dependencias externas

| Dependencia | Propósito |
|---|---|
| `@openzeppelin/contracts/utils/cryptography/ECDSA.sol` | Verificación segura de firmas ECDSA (protege contra signature malleability) |
| `@openzeppelin/contracts/utils/cryptography/EIP712.sol` | Implementación estándar de EIP-712 domain separator y hashing |
| `@openzeppelin/contracts/utils/ReentrancyGuard.sol` | Protección contra ataques de reentrancia |

### Decisión: contrato singleton vs. per-user

Se eligió un **contrato singleton** (un deployment sirve a muchos usuarios) porque:
- El modelo comunitario del paper implica que los miembros comparten infraestructura.
- Un solo deployment reduce costes para la comunidad.
- El `_isGuardian` mapping permite lookups O(1) entre cualquier par (usuario, guardián).

---

## 4. Storage Layout

### Mappings principales

```
_configs:           address → RecoveryConfig    // Configuración por cuenta protegida
_isGuardian:        address → address → bool    // Lookup rápido de guardianes
_requests:          uint256 → RecoveryRequest   // Requests por ID
_approvals:         uint256 → address → bool    // Aprobaciones por request + guardián
_activeRequest:     address → uint256           // Request activo por cuenta (0 = ninguno)
_nextRequestId:     uint256                     // Contador monotónico (empieza en 1)
```

### RecoveryConfig

| Campo | Tipo | Descripción |
|---|---|---|
| `owner` | `address` | Propietario actual (inicialmente == account address) |
| `guardians` | `address[]` | Lista ordenada ascendentemente de guardianes |
| `threshold` | `uint256` | Mínimo de aprobaciones necesarias |
| `configNonce` | `uint256` | Incrementa en cada cambio de config |
| `recoveryDataHash` | `bytes32` | Commitment a datos públicos off-chain |
| `timelockDuration` | `uint256` | Segundos de delay tras alcanzar threshold (0 = inmediato) |
| `requestExpiryDuration` | `uint256` | Duración de validity de un request |
| `active` | `bool` | Si la configuración está activa |

### RecoveryRequest

| Campo | Tipo | Descripción |
|---|---|---|
| `protectedAccount` | `address` | Identidad que se está recuperando |
| `proposedNewOwner` | `address` | Nueva dirección propietaria propuesta |
| `initiator` | `address` | Quién inició el request |
| `configNonceSnapshot` | `uint256` | Snapshot del configNonce al crear el request |
| `approvalCount` | `uint256` | Número de aprobaciones recibidas |
| `createdAt` | `uint256` | Timestamp de creación |
| `expiresAt` | `uint256` | Timestamp de expiración |
| `timelockEnd` | `uint256` | Cuándo la ejecución es posible (0 hasta threshold) |
| `thresholdReached` | `bool` | Si se alcanzaron suficientes aprobaciones |
| `executed` | `bool` | Si ya se ejecutó la recuperación |
| `cancelled` | `bool` | Si fue cancelado |

---

## 5. Funciones y Flujo

### 5.1. Flujo de configuración

```
Usuario (Alice)
    │
    ├─► configureRecovery(alice, [bob, carol, dave], 2, dataHash, 1 day, 7 days)
    │     • Valida guardianes: sorted, unique, non-zero, non-self
    │     • Valida threshold: 0 < t ≤ n
    │     • Almacena config, incrementa configNonce
    │     • Emite RecoveryConfigured
    │
    ├─► updateGuardians(alice, [bob, eve, frank], 2)      // Rotar guardianes
    │     • Limpia mappings antiguos, cancela requests activos
    │     • Almacena nuevos guardianes, incrementa configNonce
    │
    ├─► updateRecoveryData(alice, newHash)                 // Actualizar datos públicos
    │
    └─► deactivateRecovery(alice)                          // Desactivar recovery
```

### 5.2. Flujo de recuperación (Alternativa A — Firmas)

```
1. Alice pierde acceso a su clave
2. Alice (desde nueva dirección) o un guardián llama:
   ├─► initiateRecovery(alice, newAliceAddress) → requestId

3. Off-chain: contacta a guardianes Bob y Carol
   ├─► Bob firma: eth_signTypedData_v4(GuardianApproval{alice, newAddr, reqId, nonce, deadline})
   └─► Carol firma: eth_signTypedData_v4(GuardianApproval{...})

4. Relayer (o Alice) llama:
   ├─► submitSignatureApprovals(reqId, [bob, carol], [sigBob, sigCarol], [deadlines])
   │     • Verifica cada firma con ECDSA.recover
   │     • Marca aprobaciones, incrementa approvalCount
   │     • Si approvalCount ≥ threshold:
   │         ├─ timelockDuration == 0 → ejecuta inmediatamente
   │         └─ timelockDuration > 0  → establece timelockEnd, emite ThresholdReached

5. (Si timelock > 0) Tras el delay:
   ├─► finalizeRecovery(reqId)
   │     • Verifica timelock expirado y request válido
   │     • Ejecuta: config.owner = newAliceAddress
   │     • Emite RecoveryExecuted

6. (Opcional) Alice real cancela si detecta ataque:
   └─► cancelRecovery(reqId)  // Solo durante el timelock
```

### 5.3. Flujo de recuperación (Alternativa B — Votación on-chain)

```
1. initiateRecovery(alice, newAddr) → requestId

2. Cada guardián llama individualmente:
   ├─► bob.approveRecovery(reqId)
   └─► carol.approveRecovery(reqId)
       • Cada llamada: verifica guardián, registra aprobación, incrementa count
       • Al alcanzar threshold: ejecuta o inicia timelock

3. finalizeRecovery(reqId)  // Si hay timelock
```

### 5.4. Protección contra replay

Cada firma de guardián incluye:
- `protectedAccount`: liga al usuario específico
- `proposedNewOwner`: liga al resultado concreto
- `requestId`: ID único e irrepetible
- `configNonce`: invalida si la config cambia
- `deadline`: expiración individual de la firma
- `chainId` + `contractAddress`: vía EIP-712 domain separator

Un atacante no puede reutilizar una firma en:
- Otro request → `requestId` diferente
- Otro chain → `chainId` diferente
- Otro contrato → `verifyingContract` diferente
- Otra versión de config → `configNonce` diferente
- Después del deadline → `deadline` expirado

---

## 6. Seguridad

### 6.1. Amenazas y mitigaciones

| Amenaza | Mitigación |
|---|---|
| **Replay attack** | `requestId` + `configNonce` + `chainId` + `contractAddress` + `deadline` en EIP-712 |
| **Duplicate approvals** | `_approvals[requestId][guardian]` previene doble conteo |
| **Signature malleability** | OpenZeppelin `ECDSA.recover` normaliza firmas (enforce low-s) |
| **Frontrunning** | El timelock permite al owner observar y cancelar; la firma está ligada a un `proposedNewOwner` específico — un frontrunner no puede cambiar el destino |
| **Griefing por guardianes** | Un guardián malicioso puede negarse a firmar → solo es problema si t = n; usar t < n |
| **Guardian collusion** | Si ≥ t guardianes colusan, pueden forzar un recovery → el timelock da ventana al owner real para cancelar |
| **Domino effect** | Limitar off-chain cuántos usuarios protege cada guardián; MAX_GUARDIANS = 32 on-chain |
| **Owner comprometido + recovery malicioso** | El owner real puede cancelar durante el timelock. Si el owner real perdió la clave Y el atacante la tiene, el atacante tiene control total (limitación inherente — no es un escenario de recovery) |
| **Revocación de setups antiguos** | `configNonce` se incrementa en cada cambio → requests con nonce antiguo son inválidos |
| **Arrays grandes y gas** | MAX_GUARDIANS = 32; arrays bounded; `unchecked` increments; `calldata` para arrays |
| **DoS por iteración** | Todos los loops están bounded por MAX_GUARDIANS o por el array calldata del caller |
| **Guardian uniqueness** | Guardians deben estar sorted ascending → O(n) verification de unicidad |
| **Reentrancy** | `ReentrancyGuard` en `submitSignatureApprovals`, `approveRecovery`, `finalizeRecovery` |
| **Config change invalidation** | Cualquier cambio en config cancela requests activos via `_invalidateActiveRequest` |

### 6.2. Uso de OpenZeppelin

- **ECDSA**: verificación de firmas con protección contra malleability
- **EIP712**: domain separator estándar con `chainId` y `verifyingContract`
- **ReentrancyGuard**: `nonReentrant` modifier en funciones que modifican estado crítico

### 6.3. Lo que este sistema NO protege

- **Clave comprometida (no perdida)**: si un atacante tiene la clave del owner, puede cancelar recoveries y cambiar guardianes. Esto no es un escenario de recuperación sino de robo.
- **Todos los guardianes comprometidos**: si ≥ t guardianes colusan, pueden forzar la recuperación. El timelock mitiga parcialmente esto.

---

## 7. Explicación del Flujo Off-Chain

### 7.1. Cómo genera un guardián su aprobación (σ\_{i,j} EVM)

1. **Obtener parámetros del request**:
   ```javascript
   const requestId = await contract.getActiveRequestId(protectedAccount);
   const request = await contract.getRecoveryRequest(requestId);
   const config = await contract.getRecoveryConfig(protectedAccount);
   ```

2. **Construir el mensaje EIP-712**:
   ```javascript
   const domain = {
     name: "ANARKey-SocialRecovery",
     version: "1",
     chainId: await provider.getNetwork().then(n => n.chainId),
     verifyingContract: contractAddress,
   };

   const types = {
     GuardianApproval: [
       { name: "protectedAccount", type: "address" },
       { name: "proposedNewOwner", type: "address" },
       { name: "requestId", type: "uint256" },
       { name: "configNonce", type: "uint256" },
       { name: "deadline", type: "uint256" },
     ],
   };

   const deadline = Math.floor(Date.now() / 1000) + 86400; // 24h

   const value = {
     protectedAccount: protectedAccount,
     proposedNewOwner: request.proposedNewOwner,
     requestId: requestId,
     configNonce: config.configNonce,
     deadline: deadline,
   };
   ```

3. **Firmar con `eth_signTypedData_v4`**:
   ```javascript
   const signature = await guardian.signTypedData(domain, types, value);
   ```

4. **Verificar off-chain (opcional)**:
   ```javascript
   const digest = await contract.getApprovalDigest(
     protectedAccount, request.proposedNewOwner, requestId, config.configNonce, deadline
   );
   const recoveredAddress = ethers.verifyTypedData(domain, types, value, signature);
   assert(recoveredAddress === guardianAddress);
   ```

### 7.2. Cómo se envían las firmas al contrato

```javascript
// Recopilar firmas de threshold guardianes
const guardianAddresses = [bob, carol]; // sorted
const signatures = [sigBob, sigCarol];
const deadlines = [deadlineBob, deadlineCarol];

await contract.submitSignatureApprovals(
  requestId,
  guardianAddresses,
  signatures,
  deadlines
);
```

### 7.3. Qué liga cada firma al usuario y al recovery concreto

La firma está vinculada a:
- **Usuario _i_**: `protectedAccount` en el mensaje firmado
- **Resultado concreto**: `proposedNewOwner`
- **Request específico**: `requestId` (monotónico, irrepetible)
- **Versión de config**: `configNonce`
- **Tiempo**: `deadline`
- **Chain y contrato**: via EIP-712 domain separator (`chainId` + `verifyingContract`)

Esto hace que la firma sea **funcionalmente equivalente a σ\_{i,j} = H(i, sk\_j)** del paper:
- Se deriva de `sk_j` (la clave privada del guardián)
- Es específica para el usuario `i` (via `protectedAccount`)
- Es independientemente generada (sin coordinación entre guardianes)
- Es verificable on-chain sin revelar `sk_j`

---

## 8. Tests Sugeridos

### 8.1. Configuración

| # | Test | Expectativa |
|---|---|---|
| 1 | Registro correcto con guardianes válidos | `RecoveryConfigured` emitido, config almacenada |
| 2 | Guardianes duplicados | Revert `DuplicateGuardian()` |
| 3 | Guardianes no ordenados | Revert `GuardiansNotSorted()` |
| 4 | Threshold = 0 | Revert `InvalidThreshold()` |
| 5 | Threshold > num guardianes | Revert `InvalidThreshold()` |
| 6 | Owner como guardián de sí mismo | Revert `SelfGuardian()` |
| 7 | Guardián address(0) | Revert `ZeroAddress()` |
| 8 | Más de MAX_GUARDIANS guardianes | Revert `TooManyGuardians()` |
| 9 | Timelock > MAX_TIMELOCK_DURATION | Revert `TimelockTooLong()` |
| 10 | Reconfiguración por owner correcto | Config actualizada, nonce incrementado |
| 11 | Reconfiguración por non-owner | Revert `NotOwner()` |

### 8.2. Recovery con firmas (Alternativa A)

| # | Test | Expectativa |
|---|---|---|
| 12 | Recovery exitoso con threshold exacto de firmas válidas | Owner rotado, `RecoveryExecuted` emitido |
| 13 | Recovery con firmas insuficientes (< threshold) | Threshold no alcanzado |
| 14 | Firma de non-guardian | Revert `NotGuardian()` |
| 15 | Firma inválida (wrong signer) | Revert `InvalidSignature()` |
| 16 | Firma duplicada (mismo guardián 2 veces) | Revert `GuardianAlreadyApproved()` |
| 17 | Firma con deadline expirado | Revert `DeadlineExpired()` |
| 18 | Request expirado | Revert `RecoveryExpired()` |
| 19 | Envío de firmas en batches parciales | Funciona hasta acumular threshold |
| 20 | Replay de firma en otro request | Revert `InvalidSignature()` (requestId diferente) |
| 21 | Replay en otro chain | Revert `InvalidSignature()` (domain separator diferente) |

### 8.3. Recovery con votación on-chain (Alternativa B)

| # | Test | Expectativa |
|---|---|---|
| 22 | Guardian vota correctamente | `GuardianApproved` emitido |
| 23 | Non-guardian intenta votar | Revert `NotGuardian()` |
| 24 | Guardian vota 2 veces | Revert `GuardianAlreadyApproved()` |
| 25 | Threshold alcanzado por votos | Recovery ejecutado o timelock iniciado |

### 8.4. Timelock y cancelación

| # | Test | Expectativa |
|---|---|---|
| 26 | Finalize antes de timelock | Revert `TimelockNotExpired()` |
| 27 | Finalize después de timelock | Recovery ejecutado |
| 28 | Owner cancela durante timelock | Request cancelado |
| 29 | Non-owner intenta cancelar | Revert `NotOwner()` |
| 30 | Finalize tras cancelación | Revert `RecoveryAlreadyCancelled()` |

### 8.5. Rotación y consistencia

| # | Test | Expectativa |
|---|---|---|
| 31 | Rotación de guardianes cancela request activo | Request antiguo cancelado |
| 32 | Firmas con configNonce viejo | Revert `ConfigNonceMismatch()` |
| 33 | Recovery → reconfiguración por nuevo owner | Funciona correctamente |
| 34 | Deactivate recovery | Config desactivada, `initiateRecovery` reverts |
| 35 | Nuevo request tras expiración del anterior | Nuevo request creado correctamente |

### 8.6. Edge cases

| # | Test | Expectativa |
|---|---|---|
| 36 | proposedNewOwner == current owner | Revert `InvalidNewOwner()` |
| 37 | proposedNewOwner == address(0) | Revert `InvalidNewOwner()` |
| 38 | initiateRecovery con request activo no expirado | Revert `RecoveryAlreadyActive()` |
| 39 | Arrays de diferente longitud en submitSignatureApprovals | Revert `ArrayLengthMismatch()` |
| 40 | Recovery completo sin timelock (timelockDuration == 0) | Ejecución inmediata |

---

## 9. Mejoras opcionales (V2)

- **Aceptación explícita de guardianes**: los guardianes confirman on-chain que aceptan su rol.
- **Reverse guardian index**: mapping de `guardian → accounts[]` para monitorizar el domino effect.
- **Guardian staking / slashing**: penalizar guardianes que se nieguen a cooperar o que actúen maliciosamente.
- **Meta-transactions / relayer support**: gasless approvals para guardianes usando ERC-2771.
- **Integration con Account Abstraction (ERC-4337)**: módulo de recovery para smart wallets.
- **Off-chain BUSS verification**: verificar on-chain que los datos públicos del esquema BUSS son consistentes con las contribuciones de los guardianes.
- **Emit guardian-specific events with indexed guardian address** para facilitar indexing.
- **Emergency recovery**: un segundo threshold más alto para bypass del timelock en emergencias.

---

## 10. Instalación y Compilación

### Con Foundry

```bash
forge init --no-commit
forge install OpenZeppelin/openzeppelin-contracts
```

Añadir a `foundry.toml`:
```toml
[profile.default]
src = "."
remappings = ["@openzeppelin/=lib/openzeppelin-contracts/"]
```

Compilar:
```bash
forge build
```

### Con Hardhat

```bash
npm install @openzeppelin/contracts
npx hardhat compile
```
