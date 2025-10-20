# DecenReview: Decentralized Peer Review Platform

## Overview

DecenReview is a Web3 project built on the Stacks blockchain using Clarity smart contracts. It decentralizes the peer review process for academic and scientific studies, addressing real-world problems such as:

- **Centralization and Bias in Traditional Peer Review**: Traditional systems rely on centralized journals, leading to gatekeeping, conflicts of interest, and slow processes.
- **AI-Induced Errors in Research**: With the rise of AI tools like large language models, studies increasingly contain hallucinations, fabricated data, or undetected biases. DecenReview mitigates this by incorporating community-driven AI error detection and provenance tracking.
- **Lack of Transparency and Incentives**: Reviewers often work unpaid, and processes are opaque. This platform uses token incentives and blockchain transparency to encourage high-quality, timely reviews.
- **Accessibility Issues**: Emerging researchers from underrepresented regions face barriers; DecenReview democratizes access through open, permissionless participation.

The platform allows authors to submit studies (as IPFS hashes for immutability), reviewers to provide feedback with AI error flagging, and the community to vote on acceptance. Accepted studies earn reputation tokens, while malicious actors (e.g., submitting AI-plagiarized work) face slashing penalties. This solves scalability issues in academia by leveraging blockchain for trustless consensus and AI mitigation via integrated oracles or community flags.

Built with 7 Clarity smart contracts for modularity, security, and efficiency. The system uses STX (Stacks' native token) for fees and a custom ERC-20-like token (REVIEW) for incentives.

## Key Features

- **Submission and Immutability**: Studies uploaded to IPFS, hashed on-chain for tamper-proof storage.
- **Decentralized Review Process**: Anonymous or pseudonymous reviews with bounties.
- **AI Error Mitigation**: Reviewers flag potential AI errors (e.g., via integrated tools or manual checks); smart contracts enforce verification rounds if flags exceed thresholds.
- **Incentive Mechanism**: REVIEW tokens rewarded for quality reviews, staked for participation, and slashed for bad faith.
- **Governance**: DAO-style voting for platform upgrades.
- **Real-World Impact**: Reduces publication delays (from months to days), combats AI misinformation in science, and fosters global collaboration.

## Architecture

DecenReview consists of 7 interconnected Clarity smart contracts. Each is designed for a specific function, ensuring separation of concerns and auditability. Contracts interact via public functions and traits for composability.

### 1. UserRegistry Contract
   - **Purpose**: Manages user registration, roles (author, reviewer, validator), and reputation scores. Prevents sybil attacks via staking requirements.
   - **Key Functions**:
     - `register-user`: Registers a principal with a role and initial stake.
     - `update-reputation`: Adjusts scores based on review outcomes.
     - `slash-stake`: Penalizes for malicious behavior (e.g., false AI flags).
   - **Traits Used**: Ownable trait for admin controls.
   - **Real-World Solve**: Ensures only vetted participants engage, mitigating spam and AI bot submissions.

### 2. SubmissionContract
   - **Purpose**: Handles study submissions, storing IPFS hashes and metadata. Triggers review bounties.
   - **Key Functions**:
     - `submit-study`: Accepts IPFS hash, title, abstract; requires fee in STX.
     - `get-study-details`: Retrieves immutable study data.
     - `archive-study`: Marks as withdrawn if needed.
   - **Traits Used**: Fungible token trait for bounty integration.
   - **Real-World Solve**: Provides provenance for studies, allowing traceability to detect AI-generated alterations.

### 3. ReviewContract
   - **Purpose**: Facilitates peer reviews, including scores, comments, and AI error flags. Reviews are stored on-chain for transparency.
   - **Key Functions**:
     - `submit-review`: Submits review with score (1-10), comments, and AI-flag boolean.
     - `aggregate-reviews`: Computes average score for a study.
     - `flag-ai-error`: Triggers if reviewer suspects AI issues; requires evidence hash.
   - **Traits Used**: Timestamp trait for deadlines.
   - **Real-World Solve**: Decentralizes feedback, with AI flags prompting extra scrutiny to catch errors like fabricated citations.

### 4. TokenContract
   - **Purpose**: Implements the REVIEW token (SIP-010 compliant) for incentives. Tokens are minted for rewards and burned/slashing as needed.
   - **Key Functions**:
     - `mint-tokens`: Mints to reviewers based on quality.
     - `transfer`: Standard token transfer.
     - `stake-tokens`: Locks tokens for role participation.
   - **Traits Used**: SIP-010 fungible token standard.
   - **Real-World Solve**: Motivates honest participation, addressing the "free labor" issue in traditional reviews.

### 5. VotingContract
   - **Purpose**: Manages community voting on study acceptance/rejection after reviews. Uses quadratic voting for fairness.
   - **Key Functions**:
     - `start-vote`: Initiates vote on a study post-review period.
     - `cast-vote`: Allows staked users to vote yes/no.
     - `finalize-vote`: Tallies results; accepts if threshold met.
   - **Traits Used**: Voting trait with anti-collusion measures.
   - **Real-World Solve**: Achieves consensus without central editors, reducing bias.

### 6. AIErrorMitigation Contract
   - **Purpose**: Specialized contract for handling AI flags. If flags > 20%, triggers a secondary review round or oracle check (e.g., integrates with external AI detectors via oracles).
   - **Key Functions**:
     - `process-ai-flag`: Aggregates flags and escalates if needed.
     - `verify-ai-error`: Allows validators to confirm/deny flags.
     - `penalize-submission`: Slashes author's stake if confirmed AI error.
   - **Traits Used**: Oracle trait for potential off-chain AI checks.
   - **Real-World Solve**: Directly mitigates AI-induced errors, a growing problem in academia (e.g., ChatGPT-generated papers with hallucinations).

### 7. GovernanceContract
   - **Purpose**: DAO for platform governance, including parameter tweaks (e.g., review thresholds) and upgrades.
   - **Key Functions**:
     - `propose-change`: Submits proposals (e.g., update fee structure).
     - `vote-on-proposal`: Token-weighted voting.
     - `execute-proposal`: Applies changes if passed.
   - **Traits Used**: Multisig trait for security.
   - **Real-World Solve**: Enables community evolution, preventing stagnation in a dynamic field like AI-impacted research.

## Deployment and Usage

### Prerequisites
- Stacks Wallet (e.g., Hiro Wallet) for interacting.
- Clarity development environment (stacks-cli).
- IPFS for study uploads.

### Deployment Steps
1. Clone the repo: <this-repo>
2. Install dependencies: Ensure stacks-cli is installed.
3. Deploy contracts: Use `clarinet deploy` for local testing, then deploy to Stacks testnet/mainnet via Hiro console.
4. Initialize: Call `initialize` on UserRegistry and TokenContract post-deployment.

### Example Workflow
1. Author registers and submits a study (SubmissionContract).
2. Reviewers stake REVIEW tokens and submit reviews, flagging AI errors if any (ReviewContract + AIErrorMitigation).
3. After review window, community votes (VotingContract).
4. If accepted, author and reviewers earn tokens (TokenContract).
5. Governance proposals handle updates (GovernanceContract).

## Security Considerations
- All contracts use Clarity's safety features: no reentrancy, explicit error handling.
- Audited for common vulnerabilities (e.g., overflow via safe-math).
- Oracles for AI detection are optional and permissioned to avoid centralization risks.

## Roadmap
- Q1 2026: Testnet launch with basic submissions.
- Q2 2026: Integrate AI detection oracles.
- Q3 2026: Mainnet and partnerships with academic DAOs.
- Future: Cross-chain compatibility (e.g., via sBTC).

## Contributing
Fork the repo, create a branch, and submit PRs. Focus on Clarity best practices.

## License
MIT License. See LICENSE file for details.