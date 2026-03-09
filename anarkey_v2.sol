// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ANARKeyBulletinBoard
/// @notice Bulletin board y coordinador de recovery inspirado en ANARKey.
/// @dev Esta versión NO publica la secret key recuperada on-chain.
///      El contrato almacena phi y recolecta sigmas derivados de firmas
///      deterministas de guardianes. La reconstrucción final debe hacerse
///      off-chain por privacidad.
contract ANARKeyBulletinBoard {
    // ============================================================
    //                            ERRORS
    // ============================================================

    error AlreadyRegistered();
    error NotRegistered();
    error NotOwner();
    error InvalidGuardianSet();
    error InvalidThreshold();
    error InvalidPublicPoints();
    error BackupNotFound();
    error SessionNotFound();
    error GuardianNotAllowed();
    error AlreadySubmitted();
    error InvalidSignature();
    error RecoveryNotReady();
    error LengthMismatch();
    error InvalidSecretScalar();

    // ============================================================
    //                          CONSTANTS
    // ============================================================

    /// @dev Campo primo BN254 scalar field.
    /// Se usa para la aritmética modular de BUSS/Lagrange.
    uint256 public constant FIELD_MODULUS =
        21888242871839275222246405745257275088548364400416034343698204186575808495617;

    bytes32 public constant SIGMA_DOMAIN_TAG =
        keccak256("ANARKEY_SIGMA_V1");

    // ============================================================
    //                           STRUCTS
    // ============================================================

    /// @notice Participante registrado en la comunidad.
    /// @dev pkCommitment es un compromiso al public key real del esquema
    ///      que se quiere recuperar off-chain.
    struct Party {
        bool registered;
        address signer;
        bytes32 pkCommitment;
    }

    /// @notice Backup público de una party i.
    /// @dev En el paper, esto corresponde al resultado público phi producido
    ///      por Share(s, sigma_B, B).
    struct Backup {
        bool exists;
        uint256 backupId;
        uint256 ownerId;
        uint64 nonce; // sirve como session/version id del backup
        uint16 t; // umbral t, hacen falta t+1 guardianes
        uint16 guardianCount; // n-1
        bytes32 ownerPkCommitment; // commitment del pk_i
        uint256[] guardianIds; // B
        uint256[] publicPoints; // phi = f(-1), f(-2), ..., f(-(n-t-1))
        bytes32 publicPointsHash;
        bool active;
    }

    /// @notice Sesión de recovery.
    struct RecoverySession {
        bool exists;
        uint256 sessionId;
        uint256 backupId;
        uint256 ownerId;
        uint64 openedAt;
        uint16 sharesNeeded;    // t + 1
        uint16 sharesReceived;
        bool ready;
        bool closed;
    }

    // ============================================================
    //                           STORAGE
    // ============================================================

    uint256 public nextPartyId = 1;
    uint256 public nextBackupId = 1;
    uint256 public nextSessionId = 1;

    mapping(uint256 => Party) public parties;
    mapping(address => uint256) public partyIdOfSigner;

    mapping(uint256 => Backup) private _backups;
    mapping(uint256 => RecoverySession) public sessions;

    /// @dev sessionId => guardianId => submitted?
    mapping(uint256 => mapping(uint256 => bool)) public sigmaSubmitted;

    /// @dev sessionId => guardianId => sigma_{i,j}
    mapping(uint256 => mapping(uint256 => uint256)) public submittedSigma;

    /// @dev backupId => guardianId => isGuardian?
    mapping(uint256 => mapping(uint256 => bool)) public isGuardianInBackup;

    // ============================================================
    //                            EVENTS
    // ============================================================

    event PartyRegistered(
        uint256 indexed partyId,
        address indexed signer,
        bytes32 pkCommitment
    );

    event BackupPublished(
        uint256 indexed backupId,
        uint256 indexed ownerId,
        uint16 t,
        uint16 guardianCount,
        uint64 nonce,
        bytes32 publicPointsHash
    );

    event RecoveryOpened(
        uint256 indexed sessionId,
        uint256 indexed backupId,
        uint256 indexed ownerId,
        uint16 sharesNeeded
    );

    event SigmaSubmitted(
        uint256 indexed sessionId,
        uint256 indexed guardianId,
        uint256 sigma,
        bytes signature
    );

    event RecoveryReady(
        uint256 indexed sessionId,
        uint256 indexed backupId,
        uint256 indexed ownerId
    );

    event SessionClosed(uint256 indexed sessionId);

    // ============================================================
    //                      PARTY REGISTRATION
    // ============================================================

    /// @notice Registra una party y fija su commitment del public key.
    /// @dev El signer EVM representa al participante en el bulletin board.
    function registerParty(bytes32 pkCommitment) external returns (uint256 partyId) {
        if (partyIdOfSigner[msg.sender] != 0) revert AlreadyRegistered();

        partyId = nextPartyId++;
        parties[partyId] = Party({
            registered: true,
            signer: msg.sender,
            pkCommitment: pkCommitment
        });
        partyIdOfSigner[msg.sender] = partyId;

        emit PartyRegistered(partyId, msg.sender, pkCommitment);
    }

    // ============================================================
    //                          BACKUP PHASE
    // ============================================================

    /// @notice Publica el backup público phi para el owner que llama.
    /// @dev guardianIds = B, |B| = n-1
    ///      publicPoints = phi = [f(-1), f(-2), ..., f(-(n-t-1))]
    function publishBackup(
        uint256[] calldata guardianIds,
        uint16 t,
        uint256[] calldata publicPoints
    ) external returns (uint256 backupId) {
        uint256 ownerId = partyIdOfSigner[msg.sender];
        if (ownerId == 0) revert NotRegistered();

        uint256 guardianCount = guardianIds.length;
        if (guardianCount == 0) revert InvalidGuardianSet();
        if (t + 1 > guardianCount) revert InvalidThreshold();

        // En BUSS con n-1 guardianes, el número de puntos públicos es:
        // n - t - 1 = (guardianCount + 1) - t - 1 = guardianCount - t
        if (publicPoints.length != guardianCount - t) revert InvalidPublicPoints();

        _validateGuardianIds(guardianIds, ownerId);

        backupId = nextBackupId++;
        Backup storage b = _backups[backupId];

        b.exists = true;
        b.backupId = backupId;
        b.ownerId = ownerId;
        b.nonce = uint64(block.timestamp); // simple nonce/version
        b.t = t;
        b.guardianCount = uint16(guardianCount);
        b.ownerPkCommitment = parties[ownerId].pkCommitment;
        b.active = true;

        for (uint256 i = 0; i < guardianIds.length; i++) {
            uint256 gid = guardianIds[i];
            b.guardianIds.push(gid);
            isGuardianInBackup[backupId][gid] = true;
        }

        for (uint256 i = 0; i < publicPoints.length; i++) {
            require(publicPoints[i] < FIELD_MODULUS, "phi out of field");
            b.publicPoints.push(publicPoints[i]);
        }

        b.publicPointsHash = keccak256(abi.encode(publicPoints));

        emit BackupPublished(
            backupId,
            ownerId,
            t,
            uint16(guardianCount),
            b.nonce,
            b.publicPointsHash
        );
    }

    // ============================================================
    //                         RECOVERY PHASE
    // ============================================================

    /// @notice Abre una sesión de recovery para un backup existente.
    /// @dev Cualquiera puede abrirla; la privacidad real está off-chain.
    function openRecovery(uint256 backupId) external returns (uint256 sessionId) {
        Backup storage b = _backups[backupId];
        if (!b.exists || !b.active) revert BackupNotFound();

        sessionId = nextSessionId++;
        sessions[sessionId] = RecoverySession({
            exists: true,
            sessionId: sessionId,
            backupId: backupId,
            ownerId: b.ownerId,
            openedAt: uint64(block.timestamp),
            sharesNeeded: b.t + 1,
            sharesReceived: 0,
            ready: false,
            closed: false
        });

        emit RecoveryOpened(sessionId, backupId, b.ownerId, b.t + 1);
    }

    /// @notice El guardián envía su firma determinista sobre el mensaje sigma.
    /// @dev Se verifica que la firma corresponda exactamente al mensaje único del backup
    ///      y al signer EVM registrado para ese guardian.
    ///      Luego se deriva sigma = H(signature) mod F.
    function submitDeterministicSignature(
        uint256 sessionId,
        bytes calldata signature
    ) external {
        RecoverySession storage s = sessions[sessionId];
        if (!s.exists || s.closed) revert SessionNotFound();

        Backup storage b = _backups[s.backupId];
        uint256 guardianId = partyIdOfSigner[msg.sender];
        if (guardianId == 0) revert NotRegistered();
        if (!isGuardianInBackup[s.backupId][guardianId]) revert GuardianNotAllowed();
        if (sigmaSubmitted[sessionId][guardianId]) revert AlreadySubmitted();

        bytes32 digest = sigmaMessageDigest(
            b.ownerId,
            guardianId,
            b.nonce
        );

        address recovered = _recoverSigner(digest, signature);
        if (recovered != msg.sender) revert InvalidSignature();

        uint256 sigma = _hashToField(signature);
        submittedSigma[sessionId][guardianId] = sigma;
        sigmaSubmitted[sessionId][guardianId] = true;
        s.sharesReceived += 1;

        emit SigmaSubmitted(sessionId, guardianId, sigma, signature);

        if (s.sharesReceived >= s.sharesNeeded) {
            s.ready = true;
            emit RecoveryReady(sessionId, s.backupId, s.ownerId);
        }
    }

    /// @notice Cierra una sesión de recovery.
    /// @dev Puede cerrarla el owner del backup o cualquiera una vez lista.
    function closeRecovery(uint256 sessionId) external {
        RecoverySession storage s = sessions[sessionId];
        if (!s.exists || s.closed) revert SessionNotFound();

        Backup storage b = _backups[s.backupId];
        uint256 callerId = partyIdOfSigner[msg.sender];

        if (callerId != b.ownerId && !s.ready) revert NotOwner();

        s.closed = true;
        emit SessionClosed(sessionId);
    }

    // ============================================================
    //                    OFF-CHAIN RECOVERY HELPERS
    // ============================================================

    /// @notice Devuelve el backup completo necesario para reconstrucción off-chain.
    function getBackup(
        uint256 backupId
    )
        external
        view
        returns (
            uint256 ownerId,
            uint64 nonce,
            uint16 t,
            uint16 guardianCount,
            bytes32 ownerPkCommitment,
            uint256[] memory guardianIds,
            uint256[] memory publicPoints,
            bytes32 publicPointsHash,
            bool active
        )
    {
        Backup storage b = _backups[backupId];
        if (!b.exists) revert BackupNotFound();

        return (
            b.ownerId,
            b.nonce,
            b.t,
            b.guardianCount,
            b.ownerPkCommitment,
            b.guardianIds,
            b.publicPoints,
            b.publicPointsHash,
            b.active
        );
    }

    /// @notice Construye el mensaje único que el guardián debe firmar determinísticamente.
    /// @dev Esto sigue la idea del paper para cold wallets:
    ///      zeta_{i,j} = Sig_sk_j(message(i,j,nonce)),
    ///      sigma_{i,j} = H(zeta_{i,j}).
    function sigmaMessageDigest(
        uint256 ownerId,
        uint256 guardianId,
        uint64 backupNonce
    ) public view returns (bytes32) {
        return keccak256(
            abi.encode(
                SIGMA_DOMAIN_TAG,
                address(this),
                block.chainid,
                ownerId,
                guardianId,
                backupNonce
            )
        );
    }

    /// @notice Helper puramente educativo para reconstrucción BUSS.
    /// @dev NO se debería llamar en una transacción real, porque revelaría el secreto.
    ///      Úsalo solo como referencia para scripts locales / tests.
    function reconstructSecretForDemo(
        uint256 backupId,
        uint256[] calldata guardianIds,
        uint256[] calldata sigmas
    ) external view returns (uint256 secretScalar) {
        Backup storage b = _backups[backupId];
        if (!b.exists) revert BackupNotFound();

        if (guardianIds.length != b.t + 1 || sigmas.length != b.t + 1) {
            revert LengthMismatch();
        }

        return _recoverAtZero(
            b.publicPoints,
            guardianIds,
            sigmas
        );
    }

    /// @notice DEMO ONLY.
/// @dev Construye y publica un backup completo on-chain a partir del secreto y los sigmas.
///      NO usar en producción porque expone datos sensibles en la transacción.
function publishBackupFromKnownInputsDemo(
    uint256 secretScalar,
    uint256[] calldata guardianIds,
    uint256[] calldata sigmas,
    uint16 t
) external returns (uint256 backupId) {
    uint256 ownerId = partyIdOfSigner[msg.sender];
    if (ownerId == 0) revert NotRegistered();
    if (secretScalar == 0 || secretScalar >= FIELD_MODULUS) revert InvalidSecretScalar();
    if (guardianIds.length == 0) revert InvalidGuardianSet();
    if (guardianIds.length != sigmas.length) revert LengthMismatch();
    if (t + 1 > guardianIds.length) revert InvalidThreshold();

    _validateGuardianIds(guardianIds, ownerId);

    for (uint256 i = 0; i < sigmas.length; i++) {
        require(sigmas[i] < FIELD_MODULUS, "sigma out of field");
    }

    uint256 guardianCount = guardianIds.length;
    uint256 publicCount = guardianCount - t;

    uint256[] memory xs = new uint256[](guardianCount + 1);
    uint256[] memory ys = new uint256[](guardianCount + 1);

    // Punto secreto: f(0) = secretScalar
    xs[0] = 0;
    ys[0] = secretScalar;

    // Puntos de guardianes: f(j) = sigma_{i,j}
    for (uint256 i = 0; i < guardianCount; i++) {
        xs[i + 1] = guardianIds[i] % FIELD_MODULUS;
        ys[i + 1] = sigmas[i];
    }

    // Calcular phi = [f(-1), f(-2), ..., f(-(n-t-1))]
    // donde n = guardianCount + 1, así que hay guardianCount - t puntos públicos
    uint256[] memory publicPoints = new uint256[](publicCount);
    for (uint256 k = 0; k < publicCount; k++) {
        uint256 xNeg = FIELD_MODULUS - (k + 1); // representa -1, -2, ...
        publicPoints[k] = _lagrangeEvaluate(xs, ys, xNeg);
    }

    // Publicar backup igual que la ruta normal
    backupId = nextBackupId++;
    Backup storage b = _backups[backupId];

    b.exists = true;
    b.backupId = backupId;
    b.ownerId = ownerId;
    b.nonce = uint64(block.timestamp);
    b.t = t;
    b.guardianCount = uint16(guardianCount);
    b.ownerPkCommitment = parties[ownerId].pkCommitment;
    b.active = true;

    for (uint256 i = 0; i < guardianIds.length; i++) {
        uint256 gid = guardianIds[i];
        b.guardianIds.push(gid);
        isGuardianInBackup[backupId][gid] = true;
    }

    for (uint256 i = 0; i < publicPoints.length; i++) {
        b.publicPoints.push(publicPoints[i]);
    }

    b.publicPointsHash = keccak256(abi.encode(publicPoints));

    emit BackupPublished(
        backupId,
        ownerId,
        t,
        uint16(guardianCount),
        b.nonce,
        b.publicPointsHash
    );
}

    // ============================================================
    //                        INTERNAL HELPERS
    // ============================================================

    function _validateGuardianIds(
        uint256[] calldata guardianIds,
        uint256 ownerId
    ) internal view {
        uint256 last = 0;
        for (uint256 i = 0; i < guardianIds.length; i++) {
            uint256 gid = guardianIds[i];
            if (!parties[gid].registered) revert InvalidGuardianSet();
            if (gid == ownerId) revert InvalidGuardianSet();
            if (i > 0 && gid <= last) revert InvalidGuardianSet(); // ordenado + sin duplicados
            last = gid;
        }
    }

    function _recoverSigner(
        bytes32 digest,
        bytes calldata signature
    ) internal pure returns (address) {
        if (signature.length != 65) revert InvalidSignature();

        bytes32 r;
        bytes32 s;
        uint8 v;

        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }

        if (v < 27) v += 27;
        if (v != 27 && v != 28) revert InvalidSignature();

        address recovered = ecrecover(digest, v, r, s);
        if (recovered == address(0)) revert InvalidSignature();
        return recovered;
    }

    function _hashToField(bytes calldata signature) internal pure returns (uint256) {
        uint256 x = uint256(keccak256(signature)) % FIELD_MODULUS;
        return x == 0 ? 1 : x;
    }

    /// @dev Recupera f(0) a partir de:
    /// - publicPoints = [f(-1), f(-2), ..., f(-(n-t-1))]
    /// - guardianIds = [j1, ..., j_{t+1}]
    /// - sigmas = [sigma_{i,j1}, ..., sigma_{i,j_{t+1}}]
    function _recoverAtZero(
        uint256[] storage publicPoints,
        uint256[] calldata guardianIds,
        uint256[] calldata sigmas
    ) internal view returns (uint256) {
        uint256 total = publicPoints.length + guardianIds.length;
        uint256[] memory xs = new uint256[](total);
        uint256[] memory ys = new uint256[](total);

        uint256 k = 0;

        // x = -1, -2, ..., -(n-t-1) representados módulo p como p-1, p-2, ...
        for (uint256 i = 0; i < publicPoints.length; i++) {
            xs[k] = FIELD_MODULUS - (i + 1);
            ys[k] = publicPoints[i];
            k++;
        }

        // x = guardianId
        for (uint256 i = 0; i < guardianIds.length; i++) {
            xs[k] = guardianIds[i] % FIELD_MODULUS;
            ys[k] = sigmas[i] % FIELD_MODULUS;
            k++;
        }

        return _lagrangeAtZero(xs, ys);
    }

    /// @dev Interpolación de Lagrange evaluada en x=0.
    function _lagrangeAtZero(
        uint256[] memory xs,
        uint256[] memory ys
    ) internal view returns (uint256 result) {
        uint256 n = xs.length;
        result = 0;

        for (uint256 i = 0; i < n; i++) {
            uint256 num = 1;
            uint256 den = 1;

            for (uint256 j = 0; j < n; j++) {
                if (i == j) continue;

                // num *= (0 - x_j) = -x_j
                num = mulmod(num, _neg(xs[j]), FIELD_MODULUS);

                // den *= (x_i - x_j)
                den = mulmod(den, _sub(xs[i], xs[j]), FIELD_MODULUS);
            }

            uint256 lambda = mulmod(num, _inv(den), FIELD_MODULUS);
            result = addmod(result, mulmod(ys[i], lambda, FIELD_MODULUS), FIELD_MODULUS);
        }
    }

    function _neg(uint256 a) internal pure returns (uint256) {
        return a == 0 ? 0 : FIELD_MODULUS - a;
    }

    function _sub(uint256 a, uint256 b) internal pure returns (uint256) {
        return addmod(a, FIELD_MODULUS - b, FIELD_MODULUS);
    }

    /// @dev Inverso modular usando Fermat: a^(p-2) mod p
    ///      mediante el precompile modexp (0x05).
    function _inv(uint256 a) internal view returns (uint256) {
        return _modExp(a, FIELD_MODULUS - 2, FIELD_MODULUS);
    }

    function _modExp(
        uint256 base,
        uint256 exponent,
        uint256 modulus
    ) internal view returns (uint256 result) {
        bytes memory input = abi.encode(
            uint256(32),
            uint256(32),
            uint256(32),
            base,
            exponent,
            modulus
        );

        bytes memory output = new bytes(32);
        bool success;
        assembly {
            success := staticcall(
                gas(),
                0x05,
                add(input, 32),
                mload(input),
                add(output, 32),
                32
            )
        }
        require(success, "modexp failed");
        result = abi.decode(output, (uint256));
    }

    /// @dev Evalúa por interpolación de Lagrange el polinomio definido por (xs, ys) en xEval.
function _lagrangeEvaluate(
    uint256[] memory xs,
    uint256[] memory ys,
    uint256 xEval
) internal view returns (uint256 result) {
    uint256 n = xs.length;
    result = 0;

    for (uint256 i = 0; i < n; i++) {
        uint256 num = 1;
        uint256 den = 1;

        for (uint256 j = 0; j < n; j++) {
            if (i == j) continue;

            num = mulmod(num, _sub(xEval, xs[j]), FIELD_MODULUS);
            den = mulmod(den, _sub(xs[i], xs[j]), FIELD_MODULUS);
        }

        uint256 li = mulmod(num, _inv(den), FIELD_MODULUS);
        result = addmod(result, mulmod(ys[i], li, FIELD_MODULUS), FIELD_MODULUS);
    }
}
}