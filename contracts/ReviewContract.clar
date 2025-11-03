(define-constant ERR-NOT-REVIEWER u100)
(define-constant ERR-STUDY-NOT-FOUND u101)
(define-constant ERR-REVIEW-ALREADY-SUBMITTED u102)
(define-constant ERR-INVALID-SCORE u103)
(define-constant ERR-REVIEW-PERIOD-ENDED u104)
(define-constant ERR-INSUFFICIENT-STAKE u105)
(define-constant ERR-AI-FLAG-WITHOUT-EVIDENCE u106)
(define-constant ERR-FLAGS-EXCEEDED-THRESHOLD u107)
(define-constant ERR-REVIEWER-NOT-REGISTERED u108)
(define-constant ERR-STUDY-CLOSED u109)

(define-data-var next-review-id uint u0)
(define-data-var review-fee uint u500)
(define-data-var ai-flag-threshold uint u20)
(define-data-var min-reviewer-stake uint u1000)
(define-data-var review-window-blocks uint u100)

(define-map studies
  uint
  {
    ipfs-hash: (string-ascii 64),
    title: (string-utf8 200),
    abstract: (string-utf8 500),
    author: principal,
    status: uint,
    submission-block: uint,
    total-reviews: uint,
    avg-score: uint,
    ai-flags: uint,
    accepted: bool
  }
)

(define-map reviews
  { study-id: uint, reviewer: principal }
  {
    score: uint,
    comment: (string-utf8 1000),
    ai-flag: bool,
    evidence-hash: (string-ascii 64),
    timestamp: uint,
    verified: bool
  }
)

(define-map reviewer-stakes
  principal
  {
    staked-amount: uint,
    reviews-completed: uint,
    reputation-score: uint
  }
)

(define-read-only (get-study (id uint))
  (map-get? studies id)
)

(define-read-only (get-review (study-id uint) (reviewer principal))
  (map-get? reviews { study-id: study-id, reviewer: reviewer })
)

(define-read-only (get-reviewer-stake (reviewer principal))
  (map-get? reviewer-stakes reviewer)
)

(define-read-only (get-aggregate-score (study-id uint))
  (let (
        (study (unwrap! (map-get? studies study-id) (err u0)))
        (total (get total-reviews study))
      )
    (if (> total u0)
        (get avg-score study)
        u0
    )
  )
)

(define-read-only (get-ai-flag-percentage (study-id uint))
  (let (
        (study (unwrap! (map-get? studies study-id) (err u0)))
        (total (get total-reviews study))
        (flags (get ai-flags study))
      )
    (if (> total u0)
        (* u100 (/ flags total))
        u0
    )
  )
)

(define-private (validate-score (score uint))
  (if (and (<= score u10) (>= score u1))
      (ok true)
      (err ERR-INVALID-SCORE))
)

(define-private (validate-reviewer (reviewer principal))
  (let (
        (stake (map-get? reviewer-stakes reviewer))
      )
    (match stake
      s
        (if (>= (get staked-amount s) (var-get min-reviewer-stake))
            (ok true)
            (err ERR-INSUFFICIENT-STAKE))
      (err ERR-REVIEWER-NOT-REGISTERED)
    )
  )
)

(define-private (is-review-period-open (study-id uint))
  (let (
        (study (unwrap! (map-get? studies study-id) (err false)))
        (submission (get submission-block study))
        (window (var-get review-window-blocks))
      )
    (>= (- block-height submission) window)
  )
)

(define-private (update-aggregates (study-id uint) (new-score uint) (new-flag bool))
  (let* (
          (study (unwrap! (map-get? studies study-id) (err ERR-STUDY-NOT-FOUND)))
          (reviews (get total-reviews study))
          (current-avg (get avg-score study))
          (current-flags (get ai-flags study))
          (total-score (* reviews current-avg))
          (updated-reviews (+ reviews u1))
          (updated-score (+ total-score new-score))
          (updated-avg (/ updated-score updated-reviews))
          (updated-flags (if new-flag (+ current-flags u1) current-flags))
        )
    (map-set studies study-id
      {
        ipfs-hash: (get ipfs-hash study),
        title: (get title study),
        abstract: (get abstract study),
        author: (get author study),
        status: (get status study),
        submission-block: (get submission-block study),
        total-reviews: updated-reviews,
        avg-score: updated-avg,
        ai-flags: updated-flags,
        accepted: (get accepted study)
      }
    )
    (ok true)
  )
)

(define-public (stake-as-reviewer (amount uint))
  (begin
    (asserts! (> amount (var-get min-reviewer-stake)) (err ERR-INSUFFICIENT-STAKE))
    (try! (stx-transfer? amount tx-sender (as-contract tx-sender)))
    (let (
          (existing (map-get? reviewer-stakes tx-sender))
        )
      (match existing
        e
          (map-set reviewer-stakes tx-sender
            {
              staked-amount: (+ (get staked-amount e) amount),
              reviews-completed: (get reviews-completed e),
              reputation-score: (get reputation-score e)
            }
          )
        (map-insert reviewer-stakes tx-sender
          {
            staked-amount: amount,
            reviews-completed: u0,
            reputation-score: u100
          }
        )
      )
    )
    (ok true)
  )
)

(define-public (submit-review
  (study-id uint)
  (score uint)
  (comment (string-utf8 1000))
  (ai-flag bool)
  (evidence-hash (string-ascii 64))
)
  (let (
        (reviewer tx-sender)
        (study (map-get? studies study-id))
      )
    (asserts! (is-some study) (err ERR-STUDY-NOT-FOUND))
    (try! (validate-reviewer reviewer))
    (asserts! (not (map-get? reviews { study-id: study-id, reviewer: reviewer })) (err ERR-REVIEW-ALREADY-SUBMITTED))
    (asserts! (not (is-review-period-open study-id)) (err ERR-REVIEW-PERIOD-ENDED))
    (try! (validate-score score))
    (if ai-flag
        (asserts! (> (len evidence-hash) u0) (err ERR-AI-FLAG-WITHOUT-EVIDENCE))
        true
    )
    (try! (stx-transfer? (var-get review-fee) tx-sender (as-contract tx-sender)))
    (map-insert reviews { study-id: study-id, reviewer: reviewer }
      {
        score: score,
        comment: comment,
        ai-flag: ai-flag,
        evidence-hash: evidence-hash,
        timestamp: block-height,
        verified: false
      }
    )
    (try! (update-aggregates study-id score ai-flag))
    (let (
          (stake (unwrap! (map-get? reviewer-stakes reviewer) (err u0)))
        )
      (map-set reviewer-stakes reviewer
        {
          staked-amount: (get staked-amount stake),
          reviews-completed: (+ (get reviews-completed stake) u1),
          reputation-score: (get reputation-score stake)
        }
      )
    )
    (var-set next-review-id (+ (var-get next-review-id) u1))
    (print { event: "review-submitted", study-id: study-id, reviewer: reviewer })
    (ok (var-get next-review-id))
  )
)

(define-public (verify-ai-flag (study-id uint) (reviewer principal) (verified bool))
  (begin
    (asserts! (is-eq tx-sender (get author (unwrap! (map-get? studies study-id) (err ERR-STUDY-NOT-FOUND)))) (err ERR-NOT-AUTHORIZED))
    (let (
          (review (map-get? reviews { study-id: study-id, reviewer: reviewer }))
        )
      (match review
        r
          (begin
            (map-set reviews { study-id: study-id, reviewer: reviewer }
              {
                score: (get score r),
                comment: (get comment r),
                ai-flag: (get ai-flag r),
                evidence-hash: (get evidence-hash r),
                timestamp: (get timestamp r),
                verified: verified
              }
            )
            (ok true)
          )
        (err ERR-STUDY-NOT-FOUND)
      )
    )
  )
)

(define-public (close-review-period (study-id uint))
  (let (
        (study (map-get? studies study-id))
        (flag-percentage (get-ai-flag-percentage study-id))
        (threshold (var-get ai-flag-threshold))
      )
    (asserts! (is-some study) (err ERR-STUDY-NOT-FOUND))
    (asserts! (is-eq tx-sender (get author (unwrap! study (err u0)))) (err ERR-NOT-AUTHORIZED))
    (if (>= flag-percentage threshold)
        (map-set studies study-id
          {
            ipfs-hash: (get ipfs-hash study),
            title: (get title study),
            abstract: (get abstract study),
            author: (get author study),
            status: u2,
            submission-block: (get submission-block study),
            total-reviews: (get total-reviews study),
            avg-score: (get avg-score study),
            ai-flags: (get ai-flags study),
            accepted: false
          }
        )
        (map-set studies study-id
          {
            ipfs-hash: (get ipfs-hash study),
            title: (get title study),
            abstract: (get abstract study),
            author: (get author study),
            status: u1,
            submission-block: (get submission-block study),
            total-reviews: (get total-reviews study),
            avg-score: (get avg-score study),
            ai-flags: (get ai-flags study),
            accepted: true
          }
        )
    )
    (ok true)
  )
)

(define-public (withdraw-stake)
  (let (
        (stake (map-get? reviewer-stakes tx-sender))
      )
    (match stake
      s
        (begin
          (try! (as-contract (stx-transfer? (get staked-amount s) (as-contract tx-sender) tx-sender)))
          (map-delete reviewer-stakes tx-sender)
          (ok (get staked-amount s))
        )
      (err ERR-NOT-REVIEWER)
    )
  )
)

(define-public (set-review-parameters (fee uint) (threshold uint) (min-stake uint) (window uint))
  (begin
    (var-set review-fee fee)
    (var-set ai-flag-threshold threshold)
    (var-set min-reviewer-stake min-stake)
    (var-set review-window-blocks window)
    (ok true)
  )
)