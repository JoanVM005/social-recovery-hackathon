// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * SocialRecoveryVault (ANARKey-style, EVM adaptation)
 *
 * - Guardian share: y_j = HashToField(signature_j)
 * - Polynomial f has degree n-1 with f(0)=s (secret)
 * - Owner publishes extra points phi_k = f(-k) for k=1..(n-t-1)
 * - Recovery uses (t+1) guardian shares + phi points to interpolate f(0)=s.
 *
 * IMPORTANT: This is a hackathon reference implementation; optimize & harden for production.
 */
contract SocialRecoveryVault {
    // Order of secp256k1 curve (field modulus for scalar arithmetic)
    // q = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141
    uint256 internal constant Q =
        0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;

    address public owner;

    // Recovery config
    address[] public guardians;
    mapping(address => bool) public isGuardian;
    uint256 public threshold; // t (need t+1 guardian sigs)

    bytes32 public sid;       // session / vault id for domain separation
    bytes32 public commitS;   // keccak256(abi.encodePacked(scalarSecret)) commitment

    // BUSS public points: phi[k-1] = f(-k)  for k = 1..m where m = n - t - 1
    // We store only y-values. x-values are implicitly -1, -2, ...
    uint256[] public phiY;

    // Timelock-ish recovery flow
    uint256 public recoveryNonce;
    uint256 public recoveryStart;
    address public pendingNewOwner;
    uint256 public constant RECOVERY_DELAY = 10 minutes;

    event BackupConfigured(bytes32 sid, uint256 threshold, bytes32 commitS);
    event RecoveryInitiated(address indexed newOwner, uint256 nonce, uint256 startTime);
    event OwnerRecovered(address indexed oldOwner, address indexed newOwner);

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    constructor(address _owner) {
        owner = _owner;
    }

    receive() external payable {}

    function withdraw(address payable to, uint256 amount) external onlyOwner {
        require(address(this).balance >= amount, "insufficient");
        (bool ok,) = to.call{value: amount}("");
        require(ok, "transfer failed");
    }

    /**
     * Setup / backup config
     *
     * guardians_: list of guardian addresses (n-1 guardians)
     * threshold_: t  (recovery needs t+1 guardians)
     * sid_: domain separation id (can be keccak256(vaultAddress, chainId, etc.))
     * commitS_: keccak256(secretScalar)
     * phiY_: y-values of f(-1), f(-2), ..., f(-(n-t-1))
     */
    function setupBackup(
        address[] calldata guardians_,
        uint256 threshold_,
        bytes32 sid_,
        bytes32 commitS_,
        uint256[] calldata phiY_
    ) external onlyOwner {
        require(guardians_.length >= 2, "need >=2 guardians");
        require(threshold_ < guardians_.length, "t must be < #guardians");
        // phi size should be m = n - t - 1, where n = (#guardians + 1)
        // => m = (#guardians + 1) - t - 1 = #guardians - t
        require(phiY_.length == guardians_.length - threshold_, "bad phi length");

        // clear old
        for (uint256 i = 0; i < guardians.length; i++) {
            isGuardian[guardians[i]] = false;
        }
        delete guardians;
        delete phiY;

        for (uint256 i = 0; i < guardians_.length; i++) {
            address g = guardians_[i];
            require(g != address(0), "zero guardian");
            require(!isGuardian[g], "dup guardian");
            isGuardian[g] = true;
            guardians.push(g);
        }

        threshold = threshold_;
        sid = sid_;
        commitS = commitS_;

        for (uint256 i = 0; i < phiY_.length; i++) {
            require(phiY_[i] < Q, "phi not in field");
            phiY.push(phiY_[i]);
        }

        emit BackupConfigured(sid, threshold, commitS);
    }

    /**
     * Start recovery. In practice you'd also allow cancel, and/or social veto.
     */
    function initRecovery(address newOwner) external {
        require(newOwner != address(0), "zero newOwner");
        pendingNewOwner = newOwner;
        recoveryNonce += 1;
        recoveryStart = block.timestamp;
        emit RecoveryInitiated(newOwner, recoveryNonce, recoveryStart);
    }

    /**
     * Finalize recovery by providing:
     * - guardian signatures over the recovery message
     * - and the reconstructed secret s as uint256
     *
     * Contract verifies:
     * 1) timelock passed
     * 2) at least (t+1) valid guardian signatures (distinct)
     * 3) derives shares y_j = HashToField(signature_j)
     * 4) interpolates f(0) using shares + phi points
     * 5) checks keccak256(s) == commitS
     * 6) updates owner
     *
     * guardianSigs must be exactly t+1 signatures (you can relax this).
     */
    function finalizeRecovery(bytes[] calldata guardianSigs, uint256 s) external {
        require(pendingNewOwner != address(0), "no pending");
        require(block.timestamp >= recoveryStart + RECOVERY_DELAY, "delay not passed");
        require(guardianSigs.length == threshold + 1, "need t+1 sigs");
        require(s < Q, "s not in field");

        // Build interpolation points:
        // - Guardian points: x = 1..(t+1) but really should be guardian indices.
        //   We'll set x as keccak-based deterministic per guardian to avoid collisions?
        //   For simplicity (hackathon), we use x = guardianIndex+1 among provided signatures.
        //
        // Better: store an explicit x_j per guardian, or use x = uint(keccak256(guardianAddr)) mod Q (non-zero).
        //
        // - Phi points: x = -1..-m mapped to field elements Q-1, Q-2, ...
        //
        // We'll use robust x for guardians: x_j = H_to_field(guardianAddr) (non-zero).
        uint256 m = phiY.length;
        uint256 totalPoints = guardianSigs.length + m;

        uint256[] memory xs = new uint256[](totalPoints);
        uint256[] memory ys = new uint256[](totalPoints);

        // Verify guardian sigs & derive shares
        // Message: keccak256("ANARKEY_RECOVER", vault, sid, pendingNewOwner, nonce, chainId)
        bytes32 msgHash = _recoveryMessageHash();

        // Distinct guardian check
        // For simplicity we use a memory array; for larger sets use bitmap/mapping + replay guard.
        address[] memory seen = new address[](guardianSigs.length);

        for (uint256 i = 0; i < guardianSigs.length; i++) {
            address g = _recoverSigner(msgHash, guardianSigs[i]);
            require(isGuardian[g], "sig not from guardian");

            // distinct
            for (uint256 j = 0; j < i; j++) {
                require(seen[j] != g, "dup guardian sig");
            }
            seen[i] = g;

            // x_j = H_to_field(guardianAddr) (ensure non-zero)
            uint256 xj = _hashToField(abi.encodePacked("X", g, sid));
            require(xj != 0, "bad x");

            // y_j = H_to_field(signature)
            uint256 yj = _hashToField(abi.encodePacked("Y", guardianSigs[i], sid));

            xs[i] = xj;
            ys[i] = yj;
        }

        // Add phi points (public points): x = -k => mapped to Q - k
        // phiY[k-1] corresponds to f(-k)
        for (uint256 k = 1; k <= m; k++) {
            uint256 idx = guardianSigs.length + (k - 1);
            xs[idx] = Q - k;      // represents -k mod Q
            ys[idx] = phiY[k - 1];
        }

        // Interpolate f(0) from points (xs, ys)
        uint256 recoveredS = _lagrangeAtZero(xs, ys);

        // Check recovered s matches claimed s & commitment
        require(recoveredS == s, "wrong s");
        require(keccak256(abi.encodePacked(s)) == commitS, "commit mismatch");

        address old = owner;
        owner = pendingNewOwner;

        // clear pending
        pendingNewOwner = address(0);
        recoveryStart = 0;

        emit OwnerRecovered(old, owner);
    }

    // ---------------------------
    // LAGRANGE INTERPOLATION
    // ---------------------------

    /**
     * Compute f(0) for polynomial defined by points (x_i, y_i) in field mod Q.
     * f(0) = Σ y_i * Π_{j!=i} (0 - x_j)/(x_i - x_j)
     *      = Σ y_i * Π_{j!=i} (-x_j) * inv(x_i - x_j)
     */
    function _lagrangeAtZero(uint256[] memory xs, uint256[] memory ys) internal pure returns (uint256) {
        require(xs.length == ys.length, "len mismatch");
        uint256 n = xs.length;
        require(n >= 2, "need >=2 points");

        uint256 acc = 0;

        for (uint256 i = 0; i < n; i++) {
            uint256 xi = xs[i];
            uint256 yi = ys[i];
            require(xi < Q && yi < Q, "point not in field");

            uint256 num = 1; // numerator: Π_{j!=i} (0 - x_j) = Π_{j!=i} (Q - x_j)
            uint256 den = 1; // denominator: Π_{j!=i} (x_i - x_j)

            for (uint256 j = 0; j < n; j++) {
                if (j == i) continue;

                uint256 xj = xs[j];

                // num *= (-xj) mod Q
                num = mulmod(num, (Q - xj) % Q, Q);

                // den *= (xi - xj) mod Q
                uint256 diff = xi >= xj ? (xi - xj) : (Q - (xj - xi));
                require(diff != 0, "duplicate x");
                den = mulmod(den, diff, Q);
            }

            uint256 li0 = mulmod(num, _modInv(den, Q), Q);
            acc = addmod(acc, mulmod(yi, li0, Q), Q);
        }

        return acc;
    }

    /**
     * Modular inverse using Fermat: a^(p-2) mod p (Q is prime).
     * Gas-heavy but OK for small n (hackathon). For prod: precompiles or batch inversion tricks.
     */
    function _modInv(uint256 a, uint256 p) internal pure returns (uint256) {
        require(a != 0, "inv(0)");
        return _modExp(a, p - 2, p);
    }

    function _modExp(uint256 base, uint256 exp, uint256 mod_) internal pure returns (uint256 result) {
        result = 1;
        uint256 b = base % mod_;
        uint256 e = exp;
        while (e > 0) {
            if (e & 1 == 1) result = mulmod(result, b, mod_);
            b = mulmod(b, b, mod_);
            e >>= 1;
        }
    }

    // ---------------------------
    // SIGNATURE / HASH-TO-FIELD
    // ---------------------------

    function _recoveryMessageHash() internal view returns (bytes32) {
        // domain separation: chainid + vault address + sid + pendingNewOwner + nonce
        // You can swap this for full EIP-712 typed data if you want.
        return keccak256(
            abi.encodePacked(
                "ANARKEY_RECOVER",
                address(this),
                block.chainid,
                sid,
                pendingNewOwner,
                recoveryNonce
            )
        );
    }

    function _recoverSigner(bytes32 msgHash, bytes calldata sig) internal pure returns (address) {
        require(sig.length == 65, "bad sig len");
        bytes32 r;
        bytes32 s;
        uint8 v;
        // solhint-disable-next-line no-inline-assembly
        assembly {
            r := calldataload(sig.offset)
            s := calldataload(add(sig.offset, 32))
            v := byte(0, calldataload(add(sig.offset, 64)))
        }
        // Ethereum signed message prefix (optional):
        // bytes32 ethHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", msgHash));
        // return ecrecover(ethHash, v, r, s);

        // For simplicity we assume guardians sign raw msgHash (or you pass already-prefixed hash).
        address signer = ecrecover(msgHash, v, r, s);
        require(signer != address(0), "ecrecover failed");
        return signer;
    }

    /**
     * Hash arbitrary bytes to field element in [0, Q-1].
     * In practice: use keccak256 and reduce mod Q.
     */
    function _hashToField(bytes memory data) internal pure returns (uint256) {
        return uint256(keccak256(data)) % Q;
    }
}