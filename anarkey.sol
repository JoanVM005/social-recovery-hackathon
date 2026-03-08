// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/*//////////////////////////////////////////////////////////////
//                                                            //
//     █████╗ ███╗   ██╗ █████╗ ██████╗ ██╗  ██╗███████╗██╗  //
//    ██╔══██╗████╗  ██║██╔══██╗██╔══██╗██║ ██╔╝██╔════╝╚██╗ //
//    ███████║██╔██╗ ██║███████║██████╔╝█████╔╝ █████╗   ╚██╗//
//    ██╔══██║██║╚██╗██║██╔══██║██╔══██╗██╔═██╗ ██╔══╝   ██╔╝//
//    ██║  ██║██║ ╚████║██║  ██║██║  ██║██║  ██╗███████╗██╔╝ //
//    ╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝╚═╝  //
//                                                            //
//   Community Social Recovery — Inspired by ANARKey Paper    //
//   (ePrint 2025/551)                                        //
//                                                            //
//////////////////////////////////////////////////////////////*/

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title CommunitySocialRecovery
/// @author ANARKey Team
/// @notice On-chain community-based social key recovery adapted from the ANARKey paper (ePrint 2025/551).
///
/// @dev DESIGN RATIONALE — Mapping from ANARKey paper to EVM:
///
///  Paper Concept              │ EVM Adaptation
///  ──────────────────────────┼──────────────────────────────────────────────────────────
///  Guardian (party j)         │ An Ethereum address that approves recovery for user i.
///  σ_{i,j} = H(i, sk_j)      │ ECDSA signature by guardian j over EIP-712 typed data
///                             │ containing (protectedAccount_i, requestContext). The
///                             │ signature is derived from sk_j, bound to user i, and
///                             │ independently generated — no inter-guardian coordination.
///  Public recovery data       │ `recoveryDataHash`: a keccak256 commitment stored on-chain
///  (BUSS public points)       │ representing the hash of any off-chain public setup data
///                             │ (guardian commitments, polynomial evaluations, etc.).
///  Secret reconstruction      │ NOT performed on-chain. The recovery outcome is an owner
///                             │ address rotation, not a secret-key reveal.
///  Threshold (t-of-n)         │ `threshold` stored per account. Recovery requires ≥ t
///                             │ valid guardian approvals (signatures or on-chain votes).
///  Malicious guardian         │ A compromised guardian address. Mitigated by threshold
///                             │ requirement and timelock + owner-cancel mechanism.
///  Domino effect              │ If a guardian serves many accounts and is compromised,
///                             │ all those accounts' security degrades. Managed off-chain
///                             │ via guardian-count monitoring; bounded on-chain by
///                             │ MAX_GUARDIANS per account.
///  Adaptive corruption        │ Timelock window allows the real owner to detect and cancel
///                             │ a malicious recovery before execution. ConfigNonce
///                             │ invalidates stale requests upon guardian rotation.
///
///  KEY DIFFERENCE: The paper aims to reconstruct a secret key. In EVM, the
///  realistic goal is to rotate the owner address of an on-chain identity,
///  effectively transferring administrative control to a new keypair.
///
///  TWO RECOVERY ALTERNATIVES:
///  A) Signature-based (PRIMARY) — Guardians sign EIP-712 messages off-chain;
///     a relayer submits the batch on-chain. Gas-efficient, better UX.
///  B) On-chain voting (SECONDARY) — Each guardian sends a tx to approve.
///     Simpler mental model, higher total gas, available as fallback.
///
contract CommunitySocialRecovery is EIP712, ReentrancyGuard {

    // ═══════════════════════════════════════════════════════════════
    //                        CUSTOM ERRORS
    // ═══════════════════════════════════════════════════════════════

    /// @dev Caller is not the current owner of the protected account.
    error NotOwner();
    /// @dev Caller / signer is not a registered guardian.
    error NotGuardian();
    /// @dev Threshold is 0 or exceeds the number of guardians.
    error InvalidThreshold();
    /// @dev Guardian array contains a duplicate address.
    error DuplicateGuardian();
    /// @dev Guardian array is not sorted in ascending address order.
    error GuardiansNotSorted();
    /// @dev Zero address supplied where a non-zero address is required.
    error ZeroAddress();
    /// @dev Account owner cannot be a guardian of themselves.
    error SelfGuardian();
    /// @dev Guardian count exceeds MAX_GUARDIANS.
    error TooManyGuardians();
    /// @dev Guardian count is below MIN_GUARDIANS.
    error TooFewGuardians();
    /// @dev Referenced recovery request does not exist.
    error RecoveryNotFound();
    /// @dev Recovery request has expired.
    error RecoveryExpired();
    /// @dev Recovery request was already executed.
    error RecoveryAlreadyExecuted();
    /// @dev Recovery request was already cancelled.
    error RecoveryAlreadyCancelled();
    /// @dev Account has a non-expired active recovery request.
    error RecoveryAlreadyActive();
    /// @dev Account's recovery config is not active.
    error RecoveryConfigNotActive();
    /// @dev Guardian has already approved this request.
    error GuardianAlreadyApproved();
    /// @dev ECDSA signature verification failed (wrong signer or malformed).
    error InvalidSignature();
    /// @dev Approval count has not reached the required threshold.
    error InsufficientApprovals();
    /// @dev Proposed new owner is invalid (zero address or same as current).
    error InvalidNewOwner();
    /// @dev The recovery config was modified after the request was created.
    error ConfigNonceMismatch();
    /// @dev Timelock period has not yet elapsed.
    error TimelockNotExpired();
    /// @dev Threshold has not been reached for this request.
    error ThresholdNotReached();
    /// @dev Threshold was already reached; no more approvals accepted.
    error ThresholdAlreadyReached();
    /// @dev A guardian's individual signature deadline has passed.
    error DeadlineExpired();
    /// @dev Supplied arrays have mismatched lengths or are empty.
    error ArrayLengthMismatch();
    /// @dev Timelock duration exceeds the maximum allowed.
    error TimelockTooLong();
    /// @dev Request expiry duration is too short.
    error ExpiryTooShort();
    /// @dev Request expiry duration is too long.
    error ExpiryTooLong();

    // ═══════════════════════════════════════════════════════════════
    //                           EVENTS
    // ═══════════════════════════════════════════════════════════════

    /// @notice Emitted when a user configures or reconfigures their recovery setup.
    event RecoveryConfigured(
        address indexed account,
        address[] guardians,
        uint256 threshold,
        bytes32 recoveryDataHash,
        uint256 configNonce
    );

    /// @notice Emitted when guardians and/or threshold are updated independently.
    event GuardiansUpdated(
        address indexed account,
        address[] newGuardians,
        uint256 newThreshold,
        uint256 configNonce
    );

    /// @notice Emitted when the public recovery data commitment is updated.
    event RecoveryDataUpdated(
        address indexed account,
        bytes32 newRecoveryDataHash,
        uint256 configNonce
    );

    /// @notice Emitted when a new recovery request is created.
    event RecoveryInitiated(
        uint256 indexed requestId,
        address indexed protectedAccount,
        address indexed proposedNewOwner,
        address initiator,
        uint256 expiresAt
    );

    /// @notice Emitted each time a guardian's approval is recorded (signature or on-chain vote).
    event GuardianApproved(
        uint256 indexed requestId,
        address indexed guardian,
        uint256 approvalCount
    );

    /// @notice Emitted when the approval threshold is reached and timelock begins.
    event ThresholdReached(
        uint256 indexed requestId,
        uint256 timelockEnd
    );

    /// @notice Emitted when a recovery request is cancelled.
    event RecoveryCancelled(
        uint256 indexed requestId,
        address cancelledBy
    );

    /// @notice Emitted when a recovery is finalized and the owner address is rotated.
    event RecoveryExecuted(
        uint256 indexed requestId,
        address indexed protectedAccount,
        address indexed newOwner
    );

    /// @notice Emitted when a user deactivates their recovery configuration.
    event RecoveryConfigDeactivated(address indexed account);

    // ═══════════════════════════════════════════════════════════════
    //                          STRUCTS
    // ═══════════════════════════════════════════════════════════════

    /// @notice Complete recovery configuration for a protected account.
    /// @dev Stored under `_configs[account]`. The `owner` field is the address that
    ///      currently controls this identity — it starts as `account` itself and changes
    ///      after a successful recovery.
    struct RecoveryConfig {
        /// Current owner (initially == the account address itself).
        address owner;
        /// Ordered list of guardian addresses (ascending, unique).
        address[] guardians;
        /// Minimum guardian approvals required for recovery (1 ≤ threshold ≤ guardians.length).
        uint256 threshold;
        /// Monotonically increasing nonce — incremented on any configuration change.
        /// Pending recovery requests are invalidated when this changes.
        uint256 configNonce;
        /// keccak256 commitment to off-chain public recovery data.
        /// Conceptually equivalent to the BUSS public polynomial points.
        bytes32 recoveryDataHash;
        /// Seconds to wait after threshold is reached before execution can occur (0 = instant).
        uint256 timelockDuration;
        /// Duration in seconds that a recovery request remains valid.
        uint256 requestExpiryDuration;
        /// Whether this configuration is active.
        bool active;
    }

    /// @notice Represents a single recovery attempt for a protected account.
    /// @dev Only one active (non-executed, non-cancelled, non-expired) request per account.
    struct RecoveryRequest {
        /// The identity whose owner is being recovered.
        address protectedAccount;
        /// The proposed replacement owner address.
        address proposedNewOwner;
        /// Address that initiated this recovery request.
        address initiator;
        /// Snapshot of `configNonce` at creation time — request becomes stale if config changes.
        uint256 configNonceSnapshot;
        /// Number of unique guardian approvals received.
        uint256 approvalCount;
        /// Block timestamp when the request was created.
        uint256 createdAt;
        /// Block timestamp after which the request is expired.
        uint256 expiresAt;
        /// Timestamp when execution becomes possible (0 until threshold is reached; then
        /// `block.timestamp + timelockDuration`). If timelockDuration == 0, recovery is
        /// executed immediately upon reaching threshold and this stays 0.
        uint256 timelockEnd;
        /// Whether the approval threshold has been met.
        bool thresholdReached;
        /// Whether the recovery has been executed.
        bool executed;
        /// Whether the recovery has been cancelled.
        bool cancelled;
    }

    // ═══════════════════════════════════════════════════════════════
    //                         CONSTANTS
    // ═══════════════════════════════════════════════════════════════

    /// @notice Maximum guardians per account — bounds gas for iteration.
    uint256 public constant MAX_GUARDIANS = 32;

    /// @notice Minimum guardians required.
    uint256 public constant MIN_GUARDIANS = 1;

    /// @notice Maximum timelock duration (30 days).
    uint256 public constant MAX_TIMELOCK_DURATION = 30 days;

    /// @notice Minimum request expiry (1 hour).
    uint256 public constant MIN_REQUEST_EXPIRY = 1 hours;

    /// @notice Maximum request expiry (30 days).
    uint256 public constant MAX_REQUEST_EXPIRY = 30 days;

    /// @notice Default request expiry when caller passes 0 (7 days).
    uint256 public constant DEFAULT_REQUEST_EXPIRY = 7 days;

    /// @notice EIP-712 typehash for off-chain guardian approvals.
    /// @dev This is the EVM equivalent of σ_{i,j} = H(i, sk_j):
    ///      guardian j signs `(protectedAccount_i, proposedNewOwner, requestId, configNonce, deadline)`
    ///      with their private key sk_j. The resulting signature is:
    ///        • Uniquely bound to both guardian j and user i
    ///        • Independently generated (no coordination between guardians)
    ///        • Verifiable on-chain via ECDSA.recover
    ///        • Replay-protected through requestId, configNonce, chainId, and contract address
    bytes32 public constant GUARDIAN_APPROVAL_TYPEHASH = keccak256(
        "GuardianApproval(address protectedAccount,address proposedNewOwner,uint256 requestId,uint256 configNonce,uint256 deadline)"
    );

    // ═══════════════════════════════════════════════════════════════
    //                      STATE VARIABLES
    // ═══════════════════════════════════════════════════════════════

    /// @notice Recovery configurations indexed by protected-account address.
    mapping(address account => RecoveryConfig) private _configs;

    /// @notice Fast guardian membership lookup: account → guardian → bool.
    mapping(address account => mapping(address guardian => bool)) private _isGuardian;

    /// @notice Recovery requests indexed by monotonic request ID.
    mapping(uint256 requestId => RecoveryRequest) private _requests;

    /// @notice Approval tracking per request: requestId → guardian → approved.
    mapping(uint256 requestId => mapping(address guardian => bool)) private _approvals;

    /// @notice Currently active (non-terminal) request ID per account. 0 = none.
    mapping(address account => uint256 requestId) private _activeRequest;

    /// @notice Next available request ID (starts at 1; 0 is the sentinel "no request" value).
    uint256 private _nextRequestId = 1;

    // ═══════════════════════════════════════════════════════════════
    //                         MODIFIERS
    // ═══════════════════════════════════════════════════════════════

    /// @dev Reverts unless `msg.sender` is the current owner of `account`.
    modifier onlyConfigOwner(address account) {
        if (_configs[account].owner != msg.sender) revert NotOwner();
        _;
    }

    /// @dev Reverts unless the recovery configuration for `account` is active.
    modifier configActive(address account) {
        if (!_configs[account].active) revert RecoveryConfigNotActive();
        _;
    }

    // ═══════════════════════════════════════════════════════════════
    //                        CONSTRUCTOR
    // ═══════════════════════════════════════════════════════════════

    /// @notice Initialises EIP-712 domain with name "ANARKey-SocialRecovery" version "1".
    constructor() EIP712("ANARKey-SocialRecovery", "1") {}

    // ═══════════════════════════════════════════════════════════════
    //  ██████╗ ██████╗ ███╗   ██╗███████╗██╗ ██████╗
    // ██╔════╝██╔═══██╗████╗  ██║██╔════╝██║██╔════╝
    // ██║     ██║   ██║██╔██╗ ██║█████╗  ██║██║  ███╗
    // ██║     ██║   ██║██║╚██╗██║██╔══╝  ██║██║   ██║
    // ╚██████╗╚██████╔╝██║ ╚████║██║     ██║╚██████╔╝
    //  ╚═════╝ ╚═════╝ ╚═╝  ╚═══╝╚═╝     ╚═╝ ╚═════╝
    //           CONFIGURATION FUNCTIONS
    // ═══════════════════════════════════════════════════════════════

    /// @notice Configure or fully reconfigure the recovery setup for `account`.
    /// @dev On first call, `msg.sender` must equal `account` (self-registration).
    ///      On subsequent calls, `msg.sender` must be the current owner (which may
    ///      differ from `account` after a successful recovery).
    ///      Any active recovery request is automatically cancelled on reconfiguration.
    /// @param account         The protected-account identity.
    /// @param guardians       Ascending-sorted, deduplicated array of guardian addresses.
    /// @param threshold       Minimum approvals required for recovery.
    /// @param recoveryDataHash Off-chain public-recovery-data commitment (may be bytes32(0)).
    /// @param timelockDuration Seconds to delay execution after threshold (0 = instant).
    /// @param requestExpiryDuration Duration of recovery requests in seconds (0 = default 7 days).
    function configureRecovery(
        address account,
        address[] calldata guardians,
        uint256 threshold,
        bytes32 recoveryDataHash,
        uint256 timelockDuration,
        uint256 requestExpiryDuration
    ) external {
        RecoveryConfig storage config = _configs[account];

        if (config.active) {
            // Reconfiguration — only the current owner may do this.
            if (config.owner != msg.sender) revert NotOwner();
        } else {
            // First-time registration — only the account itself.
            if (account != msg.sender) revert NotOwner();
        }

        _validateGuardians(account, guardians, threshold);
        _validateTimelockAndExpiry(timelockDuration, requestExpiryDuration);

        // Wipe previous guardian mappings and cancel any pending request.
        if (config.active) {
            _clearGuardianMappings(account);
            _invalidateActiveRequest(account);
        }

        // Write new configuration.
        config.owner = config.active ? config.owner : account;
        config.guardians = guardians;
        config.threshold = threshold;
        unchecked { ++config.configNonce; }
        config.recoveryDataHash = recoveryDataHash;
        config.timelockDuration = timelockDuration;
        config.requestExpiryDuration = requestExpiryDuration == 0
            ? DEFAULT_REQUEST_EXPIRY
            : requestExpiryDuration;
        config.active = true;

        // Populate fast-lookup mapping.
        for (uint256 i; i < guardians.length; ) {
            _isGuardian[account][guardians[i]] = true;
            unchecked { ++i; }
        }

        emit RecoveryConfigured(account, guardians, threshold, recoveryDataHash, config.configNonce);
    }

    /// @notice Update guardians and threshold without changing other config fields.
    /// @dev Automatically cancels any active recovery request.
    /// @param account      The protected-account identity.
    /// @param newGuardians Ascending-sorted, deduplicated replacement guardian list.
    /// @param newThreshold New threshold value.
    function updateGuardians(
        address account,
        address[] calldata newGuardians,
        uint256 newThreshold
    ) external onlyConfigOwner(account) configActive(account) {
        _validateGuardians(account, newGuardians, newThreshold);

        _clearGuardianMappings(account);
        _invalidateActiveRequest(account);

        RecoveryConfig storage config = _configs[account];
        config.guardians = newGuardians;
        config.threshold = newThreshold;
        unchecked { ++config.configNonce; }

        for (uint256 i; i < newGuardians.length; ) {
            _isGuardian[account][newGuardians[i]] = true;
            unchecked { ++i; }
        }

        emit GuardiansUpdated(account, newGuardians, newThreshold, config.configNonce);
    }

    /// @notice Update the off-chain public recovery data commitment.
    /// @dev Increments configNonce so any pending request becomes stale.
    /// @param account             The protected-account identity.
    /// @param newRecoveryDataHash New keccak256 commitment.
    function updateRecoveryData(
        address account,
        bytes32 newRecoveryDataHash
    ) external onlyConfigOwner(account) configActive(account) {
        RecoveryConfig storage config = _configs[account];
        config.recoveryDataHash = newRecoveryDataHash;
        unchecked { ++config.configNonce; }
        _invalidateActiveRequest(account);

        emit RecoveryDataUpdated(account, newRecoveryDataHash, config.configNonce);
    }

    /// @notice Deactivate the recovery configuration entirely.
    /// @dev Clears guardian mappings and cancels any pending request. The config data
    ///      remains in storage but `active` is set to false, blocking new recoveries.
    /// @param account The protected-account identity.
    function deactivateRecovery(
        address account
    ) external onlyConfigOwner(account) configActive(account) {
        _clearGuardianMappings(account);
        _invalidateActiveRequest(account);
        _configs[account].active = false;

        emit RecoveryConfigDeactivated(account);
    }

    // ═══════════════════════════════════════════════════════════════
    // ██████╗ ███████╗ ██████╗ ██████╗ ██╗   ██╗███████╗██████╗ ██╗   ██╗
    // ██╔══██╗██╔════╝██╔════╝██╔═══██╗██║   ██║██╔════╝██╔══██╗╚██╗ ██╔╝
    // ██████╔╝█████╗  ██║     ██║   ██║██║   ██║█████╗  ██████╔╝ ╚████╔╝
    // ██╔══██╗██╔══╝  ██║     ██║   ██║╚██╗ ██╔╝██╔══╝  ██╔══██╗  ╚██╔╝
    // ██║  ██║███████╗╚██████╗╚██████╔╝ ╚████╔╝ ███████╗██║  ██║   ██║
    // ╚═╝  ╚═╝╚══════╝ ╚═════╝ ╚═════╝   ╚═══╝  ╚══════╝╚═╝  ╚═╝   ╚═╝
    //                    RECOVERY FUNCTIONS
    // ═══════════════════════════════════════════════════════════════

    /// @notice Initiate a recovery request for `protectedAccount`.
    /// @dev Anyone may call this (the user who lost their key uses a fresh address).
    ///      Only one active request per account is allowed at a time. An expired, executed,
    ///      or cancelled request is automatically superseded.
    /// @param protectedAccount The account whose owner should be rotated.
    /// @param proposedNewOwner The address that will become the new owner if recovery succeeds.
    /// @return requestId Unique identifier for the created request.
    function initiateRecovery(
        address protectedAccount,
        address proposedNewOwner
    ) external configActive(protectedAccount) returns (uint256 requestId) {
        if (proposedNewOwner == address(0)) revert InvalidNewOwner();

        RecoveryConfig storage config = _configs[protectedAccount];
        if (proposedNewOwner == config.owner) revert InvalidNewOwner();

        // Enforce at most one live request per account.
        uint256 existingId = _activeRequest[protectedAccount];
        if (existingId != 0) {
            RecoveryRequest storage existing = _requests[existingId];
            bool isTerminal = existing.executed || existing.cancelled || block.timestamp > existing.expiresAt;
            if (!isTerminal) revert RecoveryAlreadyActive();
            // Stale request — allow replacement.
        }

        requestId = _nextRequestId;
        unchecked { ++_nextRequestId; }

        uint256 expiresAt = block.timestamp + config.requestExpiryDuration;

        _requests[requestId] = RecoveryRequest({
            protectedAccount: protectedAccount,
            proposedNewOwner: proposedNewOwner,
            initiator: msg.sender,
            configNonceSnapshot: config.configNonce,
            approvalCount: 0,
            createdAt: block.timestamp,
            expiresAt: expiresAt,
            timelockEnd: 0,
            thresholdReached: false,
            executed: false,
            cancelled: false
        });

        _activeRequest[protectedAccount] = requestId;

        emit RecoveryInitiated(requestId, protectedAccount, proposedNewOwner, msg.sender, expiresAt);
    }

    // ────────────────────────────────────────────────────────────────
    //  ALTERNATIVE A — Signature-based recovery (PRIMARY)
    //
    //  Guardians sign EIP-712 typed data off-chain. A relayer (or the
    //  recovering user) bundles signatures and submits them in a single
    //  transaction. This is the closest EVM analogue to the ANARKey
    //  protocol where each guardian independently produces σ_{i,j}.
    // ────────────────────────────────────────────────────────────────

    /// @notice Submit one or more guardian EIP-712 signatures to approve a recovery.
    /// @dev Signatures may be submitted incrementally across multiple transactions
    ///      until the threshold is reached. Once threshold is met, recovery either
    ///      executes immediately (timelockDuration == 0) or enters the timelock phase.
    ///
    ///      Each element `signatures[k]` must be a valid EIP-712 signature by
    ///      `guardians[k]` over the struct:
    ///        GuardianApproval(protectedAccount, proposedNewOwner, requestId, configNonce, deadline)
    ///
    ///      This signature is the EVM σ_{i,j}: derived from sk_j, specific to user i,
    ///      and independently generated.
    ///
    /// @param requestId  The recovery request being approved.
    /// @param guardians  Addresses of the signing guardians (order matches signatures).
    /// @param signatures EIP-712 signatures (65 bytes each: r ‖ s ‖ v).
    /// @param deadlines  Per-guardian signature expiry timestamps.
    function submitSignatureApprovals(
        uint256 requestId,
        address[] calldata guardians,
        bytes[] calldata signatures,
        uint256[] calldata deadlines
    ) external nonReentrant {
        uint256 count = guardians.length;
        if (count == 0 || count != signatures.length || count != deadlines.length) {
            revert ArrayLengthMismatch();
        }

        RecoveryRequest storage request = _requests[requestId];
        _validateRequestActive(request);

        RecoveryConfig storage config = _configs[request.protectedAccount];
        if (request.configNonceSnapshot != config.configNonce) revert ConfigNonceMismatch();

        for (uint256 i; i < count; ) {
            _processSignatureApproval(
                requestId,
                request,
                config,
                guardians[i],
                signatures[i],
                deadlines[i]
            );
            unchecked { ++i; }
        }

        _checkAndFinaliseThreshold(requestId, request, config);
    }

    // ────────────────────────────────────────────────────────────────
    //  ALTERNATIVE B — On-chain voting recovery (SECONDARY)
    //
    //  Each guardian sends a transaction to approve directly. Simpler
    //  for guardians who prefer not to sign off-chain messages, but
    //  each approval costs a separate on-chain transaction.
    // ────────────────────────────────────────────────────────────────

    /// @notice A guardian approves a recovery request on-chain (Alternative B).
    /// @dev The caller must be a registered guardian for the protected account.
    /// @param requestId The recovery request to approve.
    function approveRecovery(uint256 requestId) external nonReentrant {
        RecoveryRequest storage request = _requests[requestId];
        _validateRequestActive(request);

        RecoveryConfig storage config = _configs[request.protectedAccount];
        if (request.configNonceSnapshot != config.configNonce) revert ConfigNonceMismatch();

        if (!_isGuardian[request.protectedAccount][msg.sender]) revert NotGuardian();
        if (_approvals[requestId][msg.sender]) revert GuardianAlreadyApproved();

        _approvals[requestId][msg.sender] = true;
        unchecked { ++request.approvalCount; }

        emit GuardianApproved(requestId, msg.sender, request.approvalCount);

        _checkAndFinaliseThreshold(requestId, request, config);
    }

    // ────────────────────────────────────────────────────────────────
    //  FINALIZATION & CANCELLATION
    // ────────────────────────────────────────────────────────────────

    /// @notice Finalize a recovery after the timelock period has elapsed.
    /// @dev Callable by anyone — the recovery outcome was already determined
    ///      when threshold was reached; this merely applies it after the delay.
    /// @param requestId The recovery request to finalize.
    function finalizeRecovery(uint256 requestId) external nonReentrant {
        RecoveryRequest storage request = _requests[requestId];
        if (request.protectedAccount == address(0)) revert RecoveryNotFound();
        if (request.executed) revert RecoveryAlreadyExecuted();
        if (request.cancelled) revert RecoveryAlreadyCancelled();
        if (block.timestamp > request.expiresAt) revert RecoveryExpired();
        if (!request.thresholdReached) revert ThresholdNotReached();
        if (request.timelockEnd == 0 || block.timestamp < request.timelockEnd) {
            revert TimelockNotExpired();
        }

        RecoveryConfig storage config = _configs[request.protectedAccount];
        if (request.configNonceSnapshot != config.configNonce) revert ConfigNonceMismatch();

        _executeRecovery(requestId, request, config);
    }

    /// @notice Cancel an active recovery request.
    /// @dev Only the current owner of the protected account may cancel.
    /// @param requestId The recovery request to cancel.
    function cancelRecovery(uint256 requestId) external {
        RecoveryRequest storage request = _requests[requestId];
        if (request.protectedAccount == address(0)) revert RecoveryNotFound();
        if (request.executed) revert RecoveryAlreadyExecuted();
        if (request.cancelled) revert RecoveryAlreadyCancelled();

        RecoveryConfig storage config = _configs[request.protectedAccount];
        if (config.owner != msg.sender) revert NotOwner();

        request.cancelled = true;
        _activeRequest[request.protectedAccount] = 0;

        emit RecoveryCancelled(requestId, msg.sender);
    }

    // ═══════════════════════════════════════════════════════════════
    // ██╗   ██╗██╗███████╗██╗    ██╗
    // ██║   ██║██║██╔════╝██║    ██║
    // ██║   ██║██║█████╗  ██║ █╗ ██║
    // ╚██╗ ██╔╝██║██╔══╝  ██║███╗██║
    //  ╚████╔╝ ██║███████╗╚███╔███╔╝
    //   ╚═══╝  ╚═╝╚══════╝ ╚══╝╚══╝
    //              VIEW FUNCTIONS
    // ═══════════════════════════════════════════════════════════════

    /// @notice Return the full recovery configuration for `account`.
    function getRecoveryConfig(address account)
        external
        view
        returns (
            address owner,
            address[] memory guardians,
            uint256 threshold,
            uint256 configNonce,
            bytes32 recoveryDataHash,
            uint256 timelockDuration,
            uint256 requestExpiryDuration,
            bool active
        )
    {
        RecoveryConfig storage c = _configs[account];
        return (
            c.owner,
            c.guardians,
            c.threshold,
            c.configNonce,
            c.recoveryDataHash,
            c.timelockDuration,
            c.requestExpiryDuration,
            c.active
        );
    }

    /// @notice Return a recovery request by its ID.
    function getRecoveryRequest(uint256 requestId)
        external
        view
        returns (RecoveryRequest memory)
    {
        return _requests[requestId];
    }

    /// @notice Check whether `guardian` is a registered guardian of `account`.
    function isGuardianOf(address account, address guardian) external view returns (bool) {
        return _isGuardian[account][guardian];
    }

    /// @notice Return the currently active request ID for `account` (0 = none).
    function getActiveRequestId(address account) external view returns (uint256) {
        return _activeRequest[account];
    }

    /// @notice Check whether `guardian` has approved `requestId`.
    function hasApproved(uint256 requestId, address guardian) external view returns (bool) {
        return _approvals[requestId][guardian];
    }

    /// @notice Compute the EIP-712 digest that a guardian must sign to approve a recovery.
    /// @dev Off-chain tooling calls this to construct the exact message for signing.
    ///      The returned digest is the EVM counterpart of σ_{i,j} = H(i, sk_j):
    ///      signing it with sk_j produces a contribution specific to both guardian j
    ///      and user i, with full replay protection.
    /// @param protectedAccount The identity being recovered.
    /// @param proposedNewOwner The proposed new owner address.
    /// @param requestId        The recovery request ID.
    /// @param configNonce      The current configuration nonce (must match the request snapshot).
    /// @param deadline         The guardian's chosen signature expiry timestamp.
    /// @return digest The 32-byte hash that the guardian signs with `eth_signTypedData_v4`.
    function getApprovalDigest(
        address protectedAccount,
        address proposedNewOwner,
        uint256 requestId,
        uint256 configNonce,
        uint256 deadline
    ) public view returns (bytes32 digest) {
        digest = _hashTypedDataV4(
            keccak256(
                abi.encode(
                    GUARDIAN_APPROVAL_TYPEHASH,
                    protectedAccount,
                    proposedNewOwner,
                    requestId,
                    configNonce,
                    deadline
                )
            )
        );
    }

    /// @notice Return the EIP-712 domain separator (useful for off-chain signing tools).
    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    /// @notice Return the next request ID that will be assigned.
    function nextRequestId() external view returns (uint256) {
        return _nextRequestId;
    }

    // ═══════════════════════════════════════════════════════════════
    // ██╗███╗   ██╗████████╗███████╗██████╗ ███╗   ██╗ █████╗ ██╗
    // ██║████╗  ██║╚══██╔══╝██╔════╝██╔══██╗████╗  ██║██╔══██╗██║
    // ██║██╔██╗ ██║   ██║   █████╗  ██████╔╝██╔██╗ ██║███████║██║
    // ██║██║╚██╗██║   ██║   ██╔══╝  ██╔══██╗██║╚██╗██║██╔══██║██║
    // ██║██║ ╚████║   ██║   ███████╗██║  ██║██║ ╚████║██║  ██║███████╗
    // ╚═╝╚═╝  ╚═══╝   ╚═╝   ╚══════╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝  ╚═╝╚══════╝
    //                    INTERNAL FUNCTIONS
    // ═══════════════════════════════════════════════════════════════

    /// @dev Validate guardian array invariants: non-empty, bounded, sorted ascending,
    ///      no duplicates, no zero addresses, no self-guardianship.
    function _validateGuardians(
        address account,
        address[] calldata guardians,
        uint256 threshold
    ) internal pure {
        uint256 len = guardians.length;
        if (len < MIN_GUARDIANS) revert TooFewGuardians();
        if (len > MAX_GUARDIANS) revert TooManyGuardians();
        if (threshold == 0 || threshold > len) revert InvalidThreshold();

        for (uint256 i; i < len; ) {
            address g = guardians[i];
            if (g == address(0)) revert ZeroAddress();
            if (g == account) revert SelfGuardian();

            // Guardians must be in strictly ascending order → guarantees uniqueness.
            if (i > 0) {
                if (guardians[i] == guardians[i - 1]) revert DuplicateGuardian();
                if (uint160(guardians[i]) < uint160(guardians[i - 1])) revert GuardiansNotSorted();
            }
            unchecked { ++i; }
        }
    }

    /// @dev Validate timelock and expiry duration bounds.
    function _validateTimelockAndExpiry(
        uint256 timelockDuration,
        uint256 requestExpiryDuration
    ) internal pure {
        if (timelockDuration > MAX_TIMELOCK_DURATION) revert TimelockTooLong();
        if (requestExpiryDuration != 0) {
            if (requestExpiryDuration < MIN_REQUEST_EXPIRY) revert ExpiryTooShort();
            if (requestExpiryDuration > MAX_REQUEST_EXPIRY) revert ExpiryTooLong();
        }
    }

    /// @dev Remove all guardian entries in `_isGuardian` for `account`.
    ///      Bounded by MAX_GUARDIANS, so gas is predictable.
    function _clearGuardianMappings(address account) internal {
        address[] storage guardians = _configs[account].guardians;
        uint256 len = guardians.length;
        for (uint256 i; i < len; ) {
            _isGuardian[account][guardians[i]] = false;
            unchecked { ++i; }
        }
    }

    /// @dev Cancel any non-terminal active request for `account`.
    function _invalidateActiveRequest(address account) internal {
        uint256 activeId = _activeRequest[account];
        if (activeId != 0) {
            RecoveryRequest storage req = _requests[activeId];
            if (!req.executed && !req.cancelled) {
                req.cancelled = true;
                emit RecoveryCancelled(activeId, msg.sender);
            }
            _activeRequest[account] = 0;
        }
    }

    /// @dev Revert if the request is not in a valid "accepting approvals" state.
    function _validateRequestActive(RecoveryRequest storage request) internal view {
        if (request.protectedAccount == address(0)) revert RecoveryNotFound();
        if (request.executed) revert RecoveryAlreadyExecuted();
        if (request.cancelled) revert RecoveryAlreadyCancelled();
        if (block.timestamp > request.expiresAt) revert RecoveryExpired();
        if (request.thresholdReached) revert ThresholdAlreadyReached();
    }

    /// @dev Verify and record a single guardian's EIP-712 signature.
    function _processSignatureApproval(
        uint256 requestId,
        RecoveryRequest storage request,
        RecoveryConfig storage config,
        address guardian,
        bytes calldata signature,
        uint256 deadline
    ) internal {
        if (block.timestamp > deadline) revert DeadlineExpired();
        if (!_isGuardian[request.protectedAccount][guardian]) revert NotGuardian();
        if (_approvals[requestId][guardian]) revert GuardianAlreadyApproved();

        bytes32 digest = getApprovalDigest(
            request.protectedAccount,
            request.proposedNewOwner,
            requestId,
            config.configNonce,
            deadline
        );

        address signer = ECDSA.recover(digest, signature);
        if (signer != guardian) revert InvalidSignature();

        _approvals[requestId][guardian] = true;
        unchecked { ++request.approvalCount; }

        emit GuardianApproved(requestId, guardian, request.approvalCount);
    }

    /// @dev Check whether threshold is reached and either execute immediately or start timelock.
    function _checkAndFinaliseThreshold(
        uint256 requestId,
        RecoveryRequest storage request,
        RecoveryConfig storage config
    ) internal {
        if (request.approvalCount >= config.threshold && !request.thresholdReached) {
            request.thresholdReached = true;

            if (config.timelockDuration == 0) {
                // Instant execution.
                _executeRecovery(requestId, request, config);
            } else {
                // Begin timelock.
                request.timelockEnd = block.timestamp + config.timelockDuration;
                emit ThresholdReached(requestId, request.timelockEnd);
            }
        }
    }

    /// @dev Execute the owner rotation — the core outcome of recovery.
    ///      In the ANARKey paper, this step would correspond to secret reconstruction.
    ///      In EVM, we do not reconstruct a private key; instead we transfer
    ///      administrative control by setting `config.owner = proposedNewOwner`.
    function _executeRecovery(
        uint256 requestId,
        RecoveryRequest storage request,
        RecoveryConfig storage config
    ) internal {
        request.executed = true;
        _activeRequest[request.protectedAccount] = 0;

        config.owner = request.proposedNewOwner;

        emit RecoveryExecuted(requestId, request.protectedAccount, request.proposedNewOwner);
    }
}
