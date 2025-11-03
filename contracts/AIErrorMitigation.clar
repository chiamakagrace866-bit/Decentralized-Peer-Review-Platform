;; contracts/ai-error-mitigation.clar

(define-constant ERR-NOT-AUTHORIZED u100)
(define-constant ERR-STUDY-NOT-FOUND u101)
(define-constant ERR-ALREADY-FLAGGED u102)
(define-constant ERR-FLAG-THRESHOLD-NOT-MET u103)
(define-constant ERR-INVALID-FLAG-COUNT u104)
(define-constant ERR-REVIEW-PERIOD-ENDED u105)
(define-constant ERR-VERIFICATION-FAILED u106)
(define-constant ERR-STAKE-INSUFFICIENT u107)
(define-constant ERR-ORACLE-NOT-SET u108)
(define-constant ERR-INVALID-EVIDENCE u109)
(define-constant ERR-SECONDARY-ROUND-ACTIVE u110)
(define-constant ERR-SECONDARY-ROUND-NOT-ACTIVE u111)
(define-constant ERR-MAX-FLAGS-EXCEEDED u112)
(define-constant ERR-INVALID-VERIFIER u113)
(define-constant ERR-PENALTY-ALREADY-APPLIED u114)

(define-constant FLAG-THRESHOLD-PERCENT u20)
(define-constant MIN-STAKE-AMOUNT u1000000)
(define-constant MAX-FLAGS-PER-STUDY u50)
(define-constant SECONDARY-REVIEW-BOUNTY u500000)

(define-data-var oracle-principal (optional principal) none)
(define-data-var review-contract principal 'SP000000000000000000002Q6VF78.review)
(define-data-var submission-contract principal 'SP000000000000000000002Q6VF78.submission)
(define-data-var token-contract principal 'SP000000000000000000002Q6VF78.token)

(define-map study-flags
  uint
  {
    flag-count: uint,
    flagged-by: (list 100 principal),
    evidence-hashes: (list 100 (string-ascii 64)),
    escalated: bool,
    secondary-active: bool,
    secondary-verifiers: (list 20 principal),
    verification-passed: (optional bool),
    penalty-applied: bool
  }
)

(define-map reviewer-stake
  principal
  uint
)

(define-map study-review-window
  uint
  uint
)

(define-read-only (get-oracle)
  (var-get oracle-principal)
)

(define-read-only (get-study-flags (study-id uint))
  (map-get? study-flags study-id)
)

(define-read-only (get-reviewer-stake (reviewer principal))
  (default-to u0 (map-get? reviewer-stake reviewer))
)

(define-read-only (get-review-window-end (study-id uint))
  (map-get? study-review-window study-id)
)

(define-public (set-oracle (new-oracle principal))
  (let ((current (var-get oracle-principal)))
    (asserts! (is-some (var-get oracle-principal)) (err ERR-NOT-AUTHORIZED))
    (asserts! (is-eq tx-sender (unwrap-panic current)) (err ERR-NOT-AUTHORIZED))
    (var-set oracle-principal (some new-oracle))
    (ok true)
  )
)

(define-public (stake-for-review (amount uint))
  (let ((current (get-reviewer-stake tx-sender)))
    (asserts! (>= amount MIN-STAKE-AMOUNT) (err ERR-STAKE-INSUFFICIENT))
    (try! (contract-call? (var-get token-contract) transfer amount tx-sender (as-contract tx-sender) none))
    (map-set reviewer-stake tx-sender (+ current amount))
    (ok true)
  )
)

(define-public (unstake-for-review (amount uint))
  (let ((current (get-reviewer-stake tx-sender)))
    (asserts! (>= current amount) (err ERR-STAKE-INSUFFICIENT))
    (map-set reviewer-stake tx-sender (- current amount))
    (as-contract (contract-call? (var-get token-contract) transfer amount tx-sender tx-sender none))
  )
)

(define-public (flag-ai-error
  (study-id uint)
  (evidence-hash (string-ascii 64))
)
  (let (
    (flags (default-to {
        flag-count: u0,
        flagged-by: (list),
        evidence-hashes: (list),
        escalated: false,
        secondary-active: false,
        secondary-verifiers: (list),
        verification-passed: none,
        penalty-applied: false
      } (map-get? study-flags study-id)))
    (current-count (get flag-count flags))
    (flagged-list (get flagged-by flags))
    (evidence-list (get evidence-hashes flags))
    (stake (get-reviewer-stake tx-sender))
    (review-end (unwrap! (get-review-window-end study-id) (err ERR-REVIEW-PERIOD-ENDED)))
  )
    (asserts! (<= block-height review-end) (err ERR-REVIEW-PERIOD-ENDED))
    (asserts! (>= stake MIN-STAKE-AMOUNT) (err ERR-STAKE-INSUFFICIENT))
    (asserts! (not (is-some (index-of flagged-list tx-sender))) (err ERR-ALREADY-FLAGGED))
    (asserts! (< current-count MAX-FLAGS-PER-STUDY) (err ERR-MAX-FLAGS-EXCEEDED))
    (asserts! (and (> (len evidence-hash) u0) (<= (len evidence-hash) u64)) (err ERR-INVALID-EVIDENCE))

    (let (
      (new-count (+ current-count u1))
      (new-flagged (unwrap! (as-max-len? (append flagged-list tx-sender) u100) (err ERR-INVALID-FLAG-COUNT)))
      (new-evidence (unwrap! (as-max-len? (append evidence-list evidence-hash) u100) (err ERR-INVALID-FLAG-COUNT)))
      (threshold (/ (* (try! (contract-call? (var-get submission-contract) get-total-reviewers study-id)) FLAG-THRESHOLD-PERCENT) u100))
    )
      (map-set study-flags study-id
        (merge flags {
          flag-count: new-count,
          flagged-by: new-flagged,
          evidence-hashes: new-evidence,
          escalated: (if (>= new-count threshold) true (get escalated flags))
        })
      )
      (if (>= new-count threshold)
        (try! (initiate-secondary-review study-id))
        (ok false)
      )
      (ok true)
    )
  )
)

(define-private (initiate-secondary-review (study-id uint))
  (let (
    (flags (unwrap! (map-get? study-flags study-id) (err ERR-STUDY-NOT-FOUND)))
  )
    (asserts! (not (get escalated flags)) (err ERR-SECONDARY-ROUND-ACTIVE))
    (map-set study-flags study-id
      (merge flags {
        escalated: true,
        secondary-active: true,
        secondary-verifiers: (list)
      })
    )
    (as-contract (try! (contract-call? (var-get token-contract) transfer SECONDARY-REVIEW-BOUNTY tx-sender (as-contract tx-sender) none)))
    (ok true)
  )
)

(define-public (register-as-verifier (study-id uint))
  (let (
    (flags (unwrap! (map-get? study-flags study-id) (err ERR-STUDY-NOT-FOUND)))
    (verifiers (get secondary-verifiers flags))
    (stake (get-reviewer-stake tx-sender))
  )
    (asserts! (get secondary-active flags) (err ERR-SECONDARY-ROUND-NOT-ACTIVE))
    (asserts! (>= stake MIN-STAKE-AMOUNT) (err ERR-STAKE-INSUFFICIENT))
    (asserts! (< (len verifiers) u20) (err ERR-INVALID-VERIFIER))
    (asserts! (not (is-some (index-of verifiers tx-sender))) (err ERR-ALREADY-FLAGGED))

    (map-set study-flags study-id
      (merge flags {
        secondary-verifiers: (unwrap! (as-max-len? (append verifiers tx-sender) u20) (err ERR-INVALID-VERIFIER))
      })
    )
    (ok true)
  )
)

(define-public (submit-verification
  (study-id uint)
  (is-ai-error bool)
  (justification (string-ascii 256))
)
  (let (
    (flags (unwrap! (map-get? study-flags study-id) (err ERR-STUDY-NOT-FOUND)))
    (verifiers (get secondary-verifiers flags))
  )
    (asserts! (get secondary-active flags) (err ERR-SECONDARY-ROUND-NOT-ACTIVE))
    (asserts! (is-some (index-of verifiers tx-sender)) (err ERR-NOT-AUTHORIZED))
    (asserts! (> (len justification) u0) (err ERR-INVALID-EVIDENCE))

    (let ((vote-count (if is-ai-error u1 u0)))
      (map-set study-flags study-id
        (merge flags {
          verification-passed: (some is-ai-error),
          secondary-active: false
        })
      )
      (if is-ai-error
        (try! (apply-penalty study-id))
        (ok false)
      )
      (ok true)
    )
  )
)

(define-private (apply-penalty (study-id uint))
  (let (
    (flags (unwrap! (map-get? study-flags study-id) (err ERR-STUDY-NOT-FOUND)))
    (author (try! (contract-call? (var-get submission-contract) get-study-author study-id)))
    (author-stake (default-to u0 (map-get? reviewer-stake author)))
  )
    (asserts! (not (get penalty-applied flags)) (err ERR-PENALTY-ALREADY-APPLIED))
    (asserts! (> author-stake u0) (err ERR-STAKE-INSUFFICIENT))

    (let ((slash-amount (min author-stake (/ (* author-stake u50) u100))))
      (map-set reviewer-stake author (- author-stake slash-amount))
      (map-set study-flags study-id
        (merge flags {
          penalty-applied: true
        })
      )
      (as-contract (contract-call? (var-get token-contract) transfer slash-amount tx-sender (as-contract tx-sender) none))
    )
    (ok true)
  )
)

(define-public (set-review-window (study-id uint) (end-block uint))
  (begin
    (asserts! (is-eq tx-sender (var-get review-contract)) (err ERR-NOT-AUTHORIZED))
    (map-set study-review-window study-id end-block)
    (ok true)
  )
)

(define-public (get-total-flags (study-id uint))
  (ok (get flag-count (default-to {
    flag-count: u0,
    flagged-by: (list),
    evidence-hashes: (list),
    escalated: false,
    secondary-active: false,
    secondary-verifiers: (list),
    verification-passed: none,
    penalty-applied: false
  } (map-get? study-flags study-id))))
)

(define-public (is-escalated (study-id uint))
  (ok (get escalated (default-to {
    flag-count: u0,
    flagged-by: (list),
    evidence-hashes: (list),
    escalated: false,
    secondary-active: false,
    secondary-verifiers: (list),
    verification-passed: none,
    penalty-applied: false
  } (map-get? study-flags study-id))))
)