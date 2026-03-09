// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ANARKeyOffchainBoard
/// @notice Bulletin board + recovery coordinator aligned with ANARKey's off-chain model.
/// @dev The chain stores only public backup data (phi) and collects guardian contributions.
///      Secret construction / reconstruction stays off-chain.
contract ANARKeyOffchainBoard {
    // ============================================================
    //                            ERRORS
    // ============================================================

    error AlreadyRegistered();
    error NotRegistered();
    error InvalidGuardianSet();
    error InvalidThreshold();
    error InvalidPublicPoints();
    error InvalidNonce();
    error BackupNotFound();
    error SessionNotFound();
    error GuardianNotAllowed();
    error AlreadySubmitted();
    error InvalidSignature();
    error RecoverySessionClosed();


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

    struct Party {
        bool registered;
        address signer;
        bytes32 pkCommitment;
    }

    /// @dev This corresponds to public backup information pub_i = phi_i.
    struct Backup {
        bool exists;
        uint256 backupId;
        uint256 ownerId;
        uint64 backupNonce;
        uint16 t;               // threshold parameter => need t+1 guardians at recovery
        uint16 guardianCount;   // |B| = n-1
        bytes32 ownerPkCommitment;
        uint256[] guardianIds;  // B
        uint256[] publicPoints; // phi = [f(-1), ..., f(-(n-t-1))]
        bytes32 publicPointsHash;
        bool active;
    }

    struct RecoverySession {
        bool exists;
        uint256 sessionId;
        uint256 backupId;
        uint256 ownerId;
        uint16 sharesNeeded;     // t + 1
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

    /// @dev sessionId => guardianId => submitted?
    mapping(uint256 => mapping(uint256 => bool)) public sigmaSubmitted;

    /// @dev sessionId => guardianId => sigma_{i,j}
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
        uint64 backupNonce,
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

    event RecoveryClosed(uint256 indexed sessionId);

    // ============================================================
    //                      PARTY REGISTRATION
    // ============================================================

    /// @notice Register a participant.
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
    //                         BACKUP STORAGE
    // ============================================================

    /// @notice Publish off-chain computed BUSS public points phi.
    /// @param guardianIds Sorted unique guardian ids.
    /// @param t Threshold parameter. Recovery needs t+1 guardians.
    /// @param backupNonce Chosen off-chain by owner for this backup session.
    /// @param publicPoints phi = [f(-1), ..., f(-(n-t-1))]
    function publishBackup(
        uint256[] calldata guardianIds,
        uint16 t,
        uint64 backupNonce,
        uint256[] calldata publicPoints
    ) external returns (uint256 backupId) {
        uint256 ownerId = partyIdOfSigner[msg.sender];
        if (ownerId == 0) revert NotRegistered();
        if (backupNonce == 0) revert InvalidNonce();

        uint256 guardianCount = guardianIds.length;
        if (guardianCount == 0) revert InvalidGuardianSet();
        if (t + 1 > guardianCount) revert InvalidThreshold();

        // public points count = n - t - 1 = (guardianCount + 1) - t - 1 = guardianCount - t
        if (publicPoints.length != guardianCount - t) revert InvalidPublicPoints();

        _validateGuardianIds(guardianIds, ownerId);

        for (uint256 i = 0; i < publicPoints.length; i++) {
            require(publicPoints[i] < FIELD_MODULUS, "phi out of field");
        }

        backupId = nextBackupId++;
        Backup storage b = _backups[backupId];

        b.exists = true;
        b.backupId = backupId;
        b.ownerId = ownerId;
        b.backupNonce = backupNonce;
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
    //                         RECOVERY FLOW
    // ============================================================

    function openRecovery(uint256 backupId) external returns (uint256 sessionId) {
        Backup storage b = _backups[backupId];
        if (!b.exists || !b.active) revert BackupNotFound();

        sessionId = nextSessionId++;
        sessions[sessionId] = RecoverySession({
            exists: true,
            sessionId: sessionId,
            backupId: backupId,
            ownerId: b.ownerId,
            sharesNeeded: b.t + 1,
            sharesReceived: 0,
            ready: false,
            closed: false
        });

        emit RecoveryOpened(sessionId, backupId, b.ownerId, b.t + 1);
    }

    /// @notice Guardian submits deterministic signature for this owner+guardian+backupNonce.
    /// @dev sigma_{i,j} = H(signature) mod F
    function submitDeterministicSignature(
        uint256 sessionId,
        bytes calldata signature
    ) external {
        RecoverySession storage s = sessions[sessionId];
        if (!s.exists) revert SessionNotFound();
        if (s.closed) revert RecoverySessionClosed();

        Backup storage b = _backups[s.backupId];

        uint256 guardianId = partyIdOfSigner[msg.sender];
        if (guardianId == 0) revert NotRegistered();
        if (!isGuardianInBackup[s.backupId][guardianId]) revert GuardianNotAllowed();
        if (sigmaSubmitted[sessionId][guardianId]) revert AlreadySubmitted();

        bytes32 digest = sigmaMessageDigest(
            b.ownerId,
            guardianId,
            b.backupNonce
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

    function closeRecovery(uint256 sessionId) external {
        RecoverySession storage s = sessions[sessionId];
        if (!s.exists) revert SessionNotFound();
        if (s.closed) revert RecoverySessionClosed();

        s.closed = true;
        emit RecoveryClosed(sessionId);
    }

    // ============================================================
    //                          VIEW HELPERS
    // ============================================================

    function getBackup(
        uint256 backupId
    )
        external
        view
        returns (
            uint256 ownerId,
            uint64 backupNonce,
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
            b.backupNonce,
            b.t,
            b.guardianCount,
            b.ownerPkCommitment,
            b.guardianIds,
            b.publicPoints,
            b.publicPointsHash,
            b.active
        );
    }

    function getSessionGuardianData(
        uint256 sessionId,
        uint256[] calldata guardianIds
    ) external view returns (bool[] memory submitted, uint256[] memory sigmas) {
        RecoverySession storage s = sessions[sessionId];
        if (!s.exists) revert SessionNotFound();

        submitted = new bool[](guardianIds.length);
        sigmas = new uint256[](guardianIds.length);

        for (uint256 i = 0; i < guardianIds.length; i++) {
            uint256 gid = guardianIds[i];
            submitted[i] = sigmaSubmitted[sessionId][gid];
            sigmas[i] = submittedSigma[sessionId][gid];
        }
    }

    /// @notice Unique digest that a guardian must sign deterministically.
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

    function deriveSigmaFromSignature(bytes calldata signature) external pure returns (uint256) {
        return _hashBytesToField(signature);
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
}