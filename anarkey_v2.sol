// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ANARKeyDemo
/// @notice Demo contract inspired by ANARKey / BUSS for hackathons.
/// @dev DEMO ONLY:
///      - Computes public BUSS points on-chain
///      - Derives sigma from guardian deterministic signatures
///      - Allows on-chain reconstruction for demonstration
///      This is NOT the privacy-preserving production design.
contract ANARKeyDemo {
    // ============================================================
    //                            ERRORS
    // ============================================================

    error AlreadyRegistered();
    error NotRegistered();
    error InvalidGuardianSet();
    error InvalidThreshold();
    error InvalidPublicPoints();
    error BackupNotFound();
    error SessionNotFound();
    error GuardianNotAllowed();
    error AlreadySubmitted();
    error InvalidSignature();
    error InvalidSecretScalar();
    error LengthMismatch();
    error RecoveryNotReady();
    error RecoveryClosed();

    // ============================================================
    //                          CONSTANTS
    // ============================================================

    /// @dev BN254 scalar field prime.
    uint256 public constant FIELD_MODULUS =
        21888242871839275222246405745257275088548364400416034343698204186575808495617;

    bytes32 public constant SIGMA_DOMAIN_TAG =
        keccak256("ANARKEY_SIGMA_V1");

    // ============================================================
    //                           STRUCTS
    // ============================================================

    /// @notice A community participant.
    /// @dev signer is the EVM account used for demo interactions.
    ///      pkCommitment is a commitment to the "real" public key
    ///      of the external cryptographic scheme.
    struct Party {
        bool registered;
        address signer;
        bytes32 pkCommitment;
    }

    /// @notice Public backup information.
    /// @dev This is the closest on-chain analogue of pub := phi in the paper.
    struct Backup {
        bool exists;
        uint256 backupId;
        uint256 ownerId;
        uint64 nonce; // unique per backup session
        uint16 t; // threshold parameter: need t+1 guardian shares
        uint16 guardianCount; // |B| = n-1 guardians
        bytes32 ownerPkCommitment;
        uint256[] guardianIds; // B
        uint256[] publicPoints; // phi = f(-1), f(-2), ..., f(-(n-t-1))
        bytes32 publicPointsHash;
        bool active;
    }

    /// @notice Recovery session.
    struct RecoverySession {
        bool exists;
        uint256 sessionId;
        uint256 backupId;
        uint256 ownerId;
        uint64 openedAt;
        uint16 sharesNeeded; // t + 1
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

    /// @dev backupId => guardianId => allowed?
    mapping(uint256 => mapping(uint256 => bool)) public isGuardianInBackup;

    /// @dev sessionId => guardianId => sigma already submitted?
    mapping(uint256 => mapping(uint256 => bool)) public sigmaSubmitted;

    /// @dev sessionId => guardianId => sigma value
    mapping(uint256 => mapping(uint256 => uint256)) public submittedSigma;

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
        uint256 sigma
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

    /// @notice Register a community member.
    /// @param pkCommitment Commitment to the member's public key.
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
    //                    DEMO BACKUP (ON-CHAIN)
    // ============================================================

    /// @notice DEMO ONLY.
    /// @dev Owner provides a demo secret scalar. Each guardian provides a deterministic
    ///      signature over a unique digest. Contract verifies signatures, derives
    ///      sigma_j = H(signature_j), interpolates the degree-(n-1) polynomial f,
    ///      computes public points phi, and stores the backup.
    ///
    ///      This intentionally exposes too much for production, but is ideal for demos.
    function publishBackupFromGuardianSignaturesDemo(
        uint256 secretScalar,
        uint256[] calldata guardianIds,
        bytes[] calldata signatures,
        uint16 t
    ) external returns (uint256 backupId) {
        uint256 ownerId = partyIdOfSigner[msg.sender];
        if (ownerId == 0) revert NotRegistered();
        if (secretScalar == 0 || secretScalar >= FIELD_MODULUS) revert InvalidSecretScalar();
        if (guardianIds.length == 0) revert InvalidGuardianSet();
        if (guardianIds.length != signatures.length) revert LengthMismatch();
        if (t + 1 > guardianIds.length) revert InvalidThreshold();

        _validateGuardianIds(guardianIds, ownerId);

        uint64 backupNonce = uint64(block.timestamp);
        uint256 guardianCount = guardianIds.length;

        // Build the set of private points:
        // f(0) = secretScalar
        // f(j) = sigma_{i,j} = H(signature_{i,j})
        uint256[] memory xs = new uint256[](guardianCount + 1);
        uint256[] memory ys = new uint256[](guardianCount + 1);

        xs[0] = 0;
        ys[0] = secretScalar;

        for (uint256 i = 0; i < guardianCount; i++) {
            uint256 gid = guardianIds[i];
            Party storage guardian = parties[gid];

            bytes32 digest = sigmaMessageDigest(ownerId, gid, backupNonce);
            address recovered = _recoverSigner(digest, signatures[i]);
            if (recovered != guardian.signer) revert InvalidSignature();

            uint256 sigma = _hashBytesToField(signatures[i]);

            xs[i + 1] = gid % FIELD_MODULUS;
            ys[i + 1] = sigma;
        }

        // In BUSS with n-1 guardians and threshold t+1, public points count is n-t-1.
        // Since n = guardianCount + 1, count = guardianCount - t.
        uint256 publicCount = guardianCount - t;
        uint256[] memory publicPoints = new uint256[](publicCount);

        for (uint256 k = 0; k < publicCount; k++) {
            uint256 xNeg = FIELD_MODULUS - (k + 1); // -1, -2, ...
            publicPoints[k] = _lagrangeEvaluate(xs, ys, xNeg);
        }

        backupId = nextBackupId++;
        Backup storage b = _backups[backupId];

        b.exists = true;
        b.backupId = backupId;
        b.ownerId = ownerId;
        b.nonce = backupNonce;
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
            backupNonce,
            b.publicPointsHash
        );
    }

    // ============================================================
    //                         RECOVERY PHASE
    // ============================================================

    /// @notice Open a recovery session for an existing backup.
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

    /// @notice Guardian submits the deterministic signature for recovery.
    /// @dev Contract verifies signature and derives sigma = H(signature).
    function submitDeterministicSignature(
        uint256 sessionId,
        bytes calldata signature
    ) external {
        RecoverySession storage s = sessions[sessionId];
        if (!s.exists) revert SessionNotFound();
        if (s.closed) revert RecoveryClosed();

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

        uint256 sigma = _hashBytesToField(signature);

        submittedSigma[sessionId][guardianId] = sigma;
        sigmaSubmitted[sessionId][guardianId] = true;
        s.sharesReceived += 1;

        emit SigmaSubmitted(sessionId, guardianId, sigma);

        if (s.sharesReceived >= s.sharesNeeded) {
            s.ready = true;
            emit RecoveryReady(sessionId, s.backupId, s.ownerId);
        }
    }

    /// @notice Optional demo helper: close a session.
    function closeRecovery(uint256 sessionId) external {
        RecoverySession storage s = sessions[sessionId];
        if (!s.exists) revert SessionNotFound();
        if (s.closed) revert RecoveryClosed();

        s.closed = true;
        emit SessionClosed(sessionId);
    }

    // ============================================================
    //                    OFF-CHAIN / DEMO HELPERS
    // ============================================================

    /// @notice Return all public backup data.
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

    /// @notice Unique digest a guardian must sign deterministically.
    /// @dev Includes contract address and chainid to avoid replay across deployments/chains.
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

    /// @notice DEMO ONLY.
    /// @dev Reconstruct f(0) from stored public points and provided guardian shares.
    ///      This would reveal the recovered secret if used in a transaction.
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
    /// @dev Reconstruct f(0) using sigmas already submitted during a recovery session.
    function reconstructSecretFromSessionForDemo(
        uint256 sessionId,
        uint256[] calldata guardianIds
    ) external view returns (uint256 secretScalar) {
        RecoverySession storage s = sessions[sessionId];
        if (!s.exists) revert SessionNotFound();
        if (!s.ready) revert RecoveryNotReady();
        if (guardianIds.length != s.sharesNeeded) revert LengthMismatch();

        uint256[] memory sigmas = new uint256[](guardianIds.length);

        for (uint256 i = 0; i < guardianIds.length; i++) {
            uint256 gid = guardianIds[i];
            if (!sigmaSubmitted[sessionId][gid]) revert RecoveryNotReady();
            sigmas[i] = submittedSigma[sessionId][gid];
        }

        Backup storage b = _backups[s.backupId];
        return _recoverAtZero(
            b.publicPoints,
            guardianIds,
            sigmas
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
            if (i > 0 && gid <= last) revert InvalidGuardianSet(); // sorted + unique
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

    function _hashBytesToField(bytes calldata data) internal pure returns (uint256) {
        uint256 x = uint256(keccak256(data)) % FIELD_MODULUS;
        return x == 0 ? 1 : x;
    }

    function _hashBytesToFieldMem(bytes memory data) internal pure returns (uint256) {
        uint256 x = uint256(keccak256(data)) % FIELD_MODULUS;
        return x == 0 ? 1 : x;
    }

    /// @dev Recover f(0) from:
    ///      publicPoints = [f(-1), f(-2), ..., f(-(n-t-1))]
    ///      guardianIds = [j1, ..., j_{t+1}]
    ///      sigmas     = [sigma_{i,j1}, ..., sigma_{i,j_{t+1}}]
    function _recoverAtZero(
        uint256[] storage publicPoints,
        uint256[] calldata guardianIds,
        uint256[] memory sigmas
    ) internal view returns (uint256) {
        uint256 total = publicPoints.length + guardianIds.length;
        uint256[] memory xs = new uint256[](total);
        uint256[] memory ys = new uint256[](total);

        uint256 k = 0;

        // x = -1, -2, ..., represented mod p as p-1, p-2, ...
        for (uint256 i = 0; i < publicPoints.length; i++) {
            xs[k] = FIELD_MODULUS - (i + 1);
            ys[k] = publicPoints[i];
            k++;
        }

        for (uint256 i = 0; i < guardianIds.length; i++) {
            xs[k] = guardianIds[i] % FIELD_MODULUS;
            ys[k] = sigmas[i] % FIELD_MODULUS;
            k++;
        }

        return _lagrangeAtZero(xs, ys);
    }

    /// @dev Evaluate the interpolated polynomial defined by (xs, ys) at xEval.
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

    /// @dev Lagrange interpolation evaluated at x=0.
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

                num = mulmod(num, _neg(xs[j]), FIELD_MODULUS);
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

    /// @dev Modular inverse using Fermat and modexp precompile.
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
}