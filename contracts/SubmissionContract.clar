(define-constant ERR-NOT-AUTHORIZED u100)
(define-constant ERR-INVALID-IPFS-HASH u101)
(define-constant ERR-INVALID-TITLE u102)
(define-constant ERR-INVALID-ABSTRACT u103)
(define-constant ERR-INVALID-CATEGORY u104)
(define-constant ERR-INVALID-KEYWORDS u105)
(define-constant ERR-STUDY-ALREADY-EXISTS u106)
(define-constant ERR-STUDY-NOT-FOUND u107)
(define-constant ERR-INVALID-TIMESTAMP u108)
(define-constant ERR-INVALID-FEE u109)
(define-constant ERR-INVALID-VERSION u110)
(define-constant ERR-ARCHIVE-NOT-ALLOWED u111)
(define-constant ERR-UPDATE-NOT-ALLOWED u112)
(define-constant ERR-INVALID-UPDATE-PARAM u113)
(define-constant ERR-MAX-STUDIES-EXCEEDED u114)
(define-constant ERR-INVALID-STATUS u115)
(define-constant ERR-INVALID-BOUNTY u116)
(define-constant ERR-TRANSFER-FAILED u117)
(define-constant ERR-AUTHORITY-NOT-SET u118)
(define-constant ERR-INVALID-AUTHOR u119)
(define-constant ERR-INVALID-METADATA u120)

(define-data-var next-study-id uint u0)
(define-data-var max-studies uint u10000)
(define-data-var submission-fee uint u500)
(define-data-var bounty-pool principal tx-sender)
(define-data-var authority-contract (optional principal) none)

(define-map studies
  uint
  {
    ipfs-hash: (string-ascii 46),
    title: (string-utf8 200),
    abstract: (string-utf8 1000),
    category: (string-utf8 50),
    keywords: (list 10 (string-utf8 50)),
    timestamp: uint,
    author: principal,
    version: uint,
    status: (string-ascii 20),
    bounty-amount: uint
  }
)

(define-map studies-by-hash
  (string-ascii 46)
  uint
)

(define-map study-updates
  uint
  {
    update-title: (string-utf8 200),
    update-abstract: (string-utf8 1000),
    update-timestamp: uint,
    updater: principal
  }
)

(define-read-only (get-study (id uint))
  (map-get? studies id)
)

(define-read-only (get-study-updates (id uint))
  (map-get? study-updates id)
)

(define-read-only (get-study-by-hash (hash (string-ascii 46)))
  (let ((id (map-get? studies-by-hash hash)))
    (match id study-id (get-study study-id) none)
  )
)

(define-read-only (is-study-registered (hash (string-ascii 46)))
  (is-some (map-get? studies-by-hash hash))
)

(define-private (validate-ipfs-hash (hash (string-ascii 46)))
  (if (and (> (len hash) u0) (<= (len hash) u46) (is-eq (slice? hash u0 u2) (some "Qm")))
    (ok true)
    (err ERR-INVALID-IPFS-HASH)
  )
)

(define-private (validate-title (title (string-utf8 200)))
  (if (and (> (len title) u0) (<= (len title) u200))
    (ok true)
    (err ERR-INVALID-TITLE)
  )
)

(define-private (validate-abstract (abstract (string-utf8 1000)))
  (if (and (> (len abstract) u0) (<= (len abstract) u1000))
    (ok true)
    (err ERR-INVALID-ABSTRACT)
  )
)

(define-private (validate-category (category (string-utf8 50)))
  (if (and (> (len category) u0) (<= (len category) u50))
    (ok true)
    (err ERR-INVALID-CATEGORY)
  )
)

(define-private (validate-keywords (keywords (list 10 (string-utf8 50))))
  (if (and (<= (len keywords) u10) (fold and-keywords keywords true))
    (ok true)
    (err ERR-INVALID-KEYWORDS)
  )
)

(define-private (and-keywords (kw (string-utf8 50)) (acc bool))
  (and acc (> (len kw) u0) (<= (len kw) u50))
)

(define-private (validate-timestamp (ts uint))
  (if (>= ts block-height)
    (ok true)
    (err ERR-INVALID-TIMESTAMP)
  )
)

(define-private (validate-version (version uint))
  (if (> version u0)
    (ok true)
    (err ERR-INVALID-VERSION)
  )
)

(define-private (validate-status (status (string-ascii 20)))
  (if (or (is-eq status "active") (is-eq status "archived") (is-eq status "under-review"))
    (ok true)
    (err ERR-INVALID-STATUS)
  )
)

(define-private (validate-bounty (bounty uint))
  (if (>= bounty u0)
    (ok true)
    (err ERR-INVALID-BOUNTY)
  )
)

(define-private (validate-author (author principal))
  (if (not (is-eq author tx-sender))
    (ok true)
    (err ERR-INVALID-AUTHOR)
  )
)

(define-public (set-authority-contract (contract-principal principal))
  (begin
    (asserts! (is-none (var-get authority-contract)) (err ERR-AUTHORITY-NOT-SET))
    (var-set authority-contract (some contract-principal))
    (ok true)
  )
)

(define-public (set-submission-fee (new-fee uint))
  (begin
    (asserts! (is-some (var-get authority-contract)) (err ERR-AUTHORITY-NOT-SET))
    (asserts! (>= new-fee u0) (err ERR-INVALID-FEE))
    (var-set submission-fee new-fee)
    (ok true)
  )
)

(define-public (set-max-studies (new-max uint))
  (begin
    (asserts! (is-some (var-get authority-contract)) (err ERR-AUTHORITY-NOT-SET))
    (asserts! (> new-max u0) (err ERR-MAX-STUDIES-EXCEEDED))
    (var-set max-studies new-max)
    (ok true)
  )
)

(define-public (set-bounty-pool (new-pool principal))
  (begin
    (asserts! (is-some (var-get authority-contract)) (err ERR-AUTHORITY-NOT-SET))
    (var-set bounty-pool new-pool)
    (ok true)
  )
)

(define-public (submit-study
  (ipfs-hash (string-ascii 46))
  (title (string-utf8 200))
  (abstract (string-utf8 1000))
  (category (string-utf8 50))
  (keywords (list 10 (string-utf8 50)))
  (bounty-amount uint)
  )
  (let (
    (next-id (var-get next-study-id))
    (current-max (var-get max-studies))
    (authority (var-get authority-contract))
    (fee (var-get submission-fee))
    )
    (asserts! (< next-id current-max) (err ERR-MAX-STUDIES-EXCEEDED))
    (try! (validate-ipfs-hash ipfs-hash))
    (try! (validate-title title))
    (try! (validate-abstract abstract))
    (try! (validate-category category))
    (try! (validate-keywords keywords))
    (try! (validate-bounty bounty-amount))
    (asserts! (is-none (map-get? studies-by-hash ipfs-hash)) (err ERR-STUDY-ALREADY-EXISTS))
    (match authority auth
      (try! (stx-transfer? fee tx-sender auth))
      (err ERR-AUTHORITY-NOT-SET)
    )
    (try! (stx-transfer? bounty-amount tx-sender (var-get bounty-pool)))
    (map-set studies next-id
      {
        ipfs-hash: ipfs-hash,
        title: title,
        abstract: abstract,
        category: category,
        keywords: keywords,
        timestamp: block-height,
        author: tx-sender,
        version: u1,
        status: "active",
        bounty-amount: bounty-amount
      }
    )
    (map-set studies-by-hash ipfs-hash next-id)
    (var-set next-study-id (+ next-id u1))
    (print { event: "study-submitted", id: next-id, hash: ipfs-hash })
    (ok next-id)
  )
)

(define-public (update-study
  (study-id uint)
  (new-title (string-utf8 200))
  (new-abstract (string-utf8 1000))
  )
  (let ((study (map-get? studies study-id)))
    (match study s
      (begin
        (asserts! (is-eq (get author s) tx-sender) (err ERR-NOT-AUTHORIZED))
        (asserts! (is-eq (get status s) "active") (err ERR-UPDATE-NOT-ALLOWED))
        (try! (validate-title new-title))
        (try! (validate-abstract new-abstract))
        (map-set studies study-id
          (merge s
            {
              title: new-title,
              abstract: new-abstract,
              timestamp: block-height,
              version: (+ (get version s) u1)
            }
          )
        )
        (map-set study-updates study-id
          {
            update-title: new-title,
            update-abstract: new-abstract,
            update-timestamp: block-height,
            updater: tx-sender
          }
        )
        (print { event: "study-updated", id: study-id })
        (ok true)
      )
      (err ERR-STUDY-NOT-FOUND)
    )
  )
)

(define-public (archive-study (study-id uint))
  (let ((study (map-get? studies study-id)))
    (match study s
      (begin
        (asserts! (is-eq (get author s) tx-sender) (err ERR-NOT-AUTHORIZED))
        (asserts! (is-eq (get status s) "active") (err ERR-ARCHIVE-NOT-ALLOWED))
        (map-set studies study-id
          (merge s { status: "archived" })
        )
        (print { event: "study-archived", id: study-id })
        (ok true)
      )
      (err ERR-STUDY-NOT-FOUND)
    )
  )
)

(define-public (get-study-count)
  (ok (var-get next-study-id))
)

(define-public (check-study-existence (hash (string-ascii 46)))
  (ok (is-study-registered hash))
)