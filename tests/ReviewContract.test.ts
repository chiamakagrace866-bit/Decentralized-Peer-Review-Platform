import { describe, it, expect, beforeEach } from "vitest";
import { 
  stringUtf8CV, 
  stringAsciiCV, 
  uintCV, 
  boolCV, 
  principalCV,
  okCV,
  errCV,
  ClarityType
} from "@stacks/transactions";
import { 
  ReviewContractMock,
  Study,
  Review,
  ReviewerStake,
  Result
} from "./types";

const ERR_NOT_REVIEWER = 100;
const ERR_STUDY_NOT_FOUND = 101;
const ERR_REVIEW_ALREADY_SUBMITTED = 102;
const ERR_INVALID_SCORE = 103;
const ERR_REVIEW_PERIOD_ENDED = 104;
const ERR_INSUFFICIENT_STAKE = 105;
const ERR_AI_FLAG_WITHOUT_EVIDENCE = 106;
const ERR_FLAGS_EXCEEDED_THRESHOLD = 107;
const ERR_REVIEWER_NOT_REGISTERED = 108;
const ERR_STUDY_CLOSED = 109;

class ReviewContractMock {
  state: {
    nextReviewId: number;
    reviewFee: number;
    aiFlagThreshold: number;
    minReviewerStake: number;
    reviewWindowBlocks: number;
    studies: Map<number, Study>;
    reviews: Map<string, Review>;
    reviewerStakes: Map<string, ReviewerStake>;
    stxBalances: Map<string, number>;
  } = {
    nextReviewId: 0,
    reviewFee: 500,
    aiFlagThreshold: 20,
    minReviewerStake: 1000,
    reviewWindowBlocks: 100,
    studies: new Map(),
    reviews: new Map(),
    reviewerStakes: new Map(),
    stxBalances: new Map([
      ["ST1AUTHOR", 10000],
      ["ST1REVIEWER", 5000],
      ["ST2REVIEWER", 5000]
    ]),
  };

  blockHeight: number = 0;
  caller: string = "ST1AUTHOR";

  constructor() {
    this.reset();
  }

  reset() {
    this.state = {
      nextReviewId: 0,
      reviewFee: 500,
      aiFlagThreshold: 20,
      minReviewerStake: 1000,
      reviewWindowBlocks: 100,
      studies: new Map(),
      reviews: new Map(),
      reviewerStakes: new Map(),
      stxBalances: new Map([
        ["ST1AUTHOR", 10000],
        ["ST1REVIEWER", 5000],
        ["ST2REVIEWER", 5000]
      ]),
    };
    this.blockHeight = 0;
    this.caller = "ST1AUTHOR";
  }

  createStudy(
    id: number,
    ipfsHash: string,
    title: string,
    abstract: string
  ): Result<number> {
    this.state.studies.set(id, {
      ipfsHash,
      title,
      abstract,
      author: this.caller,
      status: 0,
      submissionBlock: this.blockHeight,
      totalReviews: 0,
      avgScore: 0,
      aiFlags: 0,
      accepted: false
    });
    return { ok: true, value: id };
  }

  stakeAsReviewer(amount: number): Result<boolean> {
    if (this.state.stxBalances.get(this.caller)! < amount) {
      return { ok: false, value: false };
    }
    this.state.stxBalances.set(this.caller, 
      this.state.stxBalances.get(this.caller)! - amount
    );
    
    const key = this.caller;
    const existing = this.state.reviewerStakes.get(key);
    
    if (existing) {
      this.state.reviewerStakes.set(key, {
        stakedAmount: existing.stakedAmount + amount,
        reviewsCompleted: existing.reviewsCompleted,
        reputationScore: existing.reputationScore
      });
    } else {
      this.state.reviewerStakes.set(key, {
        stakedAmount: amount,
        reviewsCompleted: 0,
        reputationScore: 100
      });
    }
    
    return { ok: true, value: true };
  }

  submitReview(
    studyId: number,
    score: number,
    comment: string,
    aiFlag: boolean,
    evidenceHash: string
  ): Result<number> {
    const study = this.state.studies.get(studyId);
    if (!study) return { ok: false, value: ERR_STUDY_NOT_FOUND };

    const reviewerKey = `${studyId}-${this.caller}`;
    if (this.state.reviews.has(reviewerKey)) {
      return { ok: false, value: ERR_REVIEW_ALREADY_SUBMITTED };
    }

    if (score < 1 || score > 10) {
      return { ok: false, value: ERR_INVALID_SCORE };
    }

    const stake = this.state.reviewerStakes.get(this.caller);
    if (!stake || stake.stakedAmount < this.state.minReviewerStake) {
      return { ok: false, value: ERR_INSUFFICIENT_STAKE };
    }

    if (aiFlag && evidenceHash.length === 0) {
      return { ok: false, value: ERR_AI_FLAG_WITHOUT_EVIDENCE };
    }

    if (this.blockHeight - study.submissionBlock > this.state.reviewWindowBlocks) {
      return { ok: false, value: ERR_REVIEW_PERIOD_ENDED };
    }

    if (this.state.stxBalances.get(this.caller)! < this.state.reviewFee) {
      return { ok: false, value: false };
    }

    this.state.stxBalances.set(this.caller, 
      this.state.stxBalances.get(this.caller)! - this.state.reviewFee
    );

    this.state.reviews.set(reviewerKey, {
      score,
      comment,
      aiFlag,
      evidenceHash,
      timestamp: this.blockHeight,
      verified: false
    });

    const totalReviews = study.totalReviews + 1;
    const totalScore = (study.totalReviews * study.avgScore) + score;
    const avgScore = Math.floor(totalScore / totalReviews);
    const aiFlags = aiFlag ? study.aiFlags + 1 : study.aiFlags;

    this.state.studies.set(studyId, {
      ...study,
      totalReviews,
      avgScore,
      aiFlags
    });

    const reviewerStake = this.state.reviewerStakes.get(this.caller)!;
    this.state.reviewerStakes.set(this.caller, {
      ...reviewerStake,
      reviewsCompleted: reviewerStake.reviewsCompleted + 1
    });

    this.state.nextReviewId++;
    return { ok: true, value: this.state.nextReviewId - 1 };
  }

  verifyAiFlag(studyId: number, reviewer: string, verified: boolean): Result<boolean> {
    const study = this.state.studies.get(studyId);
    if (!study || study.author !== this.caller) {
      return { ok: false, value: false };
    }

    const reviewKey = `${studyId}-${reviewer}`;
    const review = this.state.reviews.get(reviewKey);
    if (!review) return { ok: false, value: false };

    this.state.reviews.set(reviewKey, { ...review, verified });
    return { ok: true, value: true };
  }

  closeReviewPeriod(studyId: number): Result<boolean> {
    const study = this.state.studies.get(studyId);
    if (!study || study.author !== this.caller) {
      return { ok: false, value: false };
    }

    const flagPercentage = study.totalReviews > 0 
      ? Math.floor((study.aiFlags * 100) / study.totalReviews) 
      : 0;

    this.state.studies.set(studyId, {
      ...study,
      status: flagPercentage >= this.state.aiFlagThreshold ? 2 : 1,
      accepted: flagPercentage < this.state.aiFlagThreshold
    });

    return { ok: true, value: true };
  }

  withdrawStake(): Result<number> {
    const stake = this.state.reviewerStakes.get(this.caller);
    if (!stake) return { ok: false, value: ERR_NOT_REVIEWER };

    this.state.reviewerStakes.delete(this.caller);
    this.state.stxBalances.set(this.caller, 
      this.state.stxBalances.get(this.caller)! + stake.stakedAmount
    );

    return { ok: true, value: stake.stakedAmount };
  }

  getStudy(id: number): Study | null {
    return this.state.studies.get(id) || null;
  }

  getReview(studyId: number, reviewer: string): Review | null {
    return this.state.reviews.get(`${studyId}-${reviewer}`) || null;
  }

  getReviewerStake(reviewer: string): ReviewerStake | null {
    return this.state.reviewerStakes.get(reviewer) || null;
  }

  getAggregateScore(studyId: number): number {
    const study = this.state.studies.get(studyId);
    return study ? study.avgScore : 0;
  }

  getAiFlagPercentage(studyId: number): number {
    const study = this.state.studies.get(studyId);
    if (!study || study.totalReviews === 0) return 0;
    return Math.floor((study.aiFlags * 100) / study.totalReviews);
  }
}

describe("ReviewContract", () => {
  let contract: ReviewContractMock;

  beforeEach(() => {
    contract = new ReviewContractMock();
    contract.reset();
  });

  it("submits review successfully", () => {
    contract.caller = "ST1REVIEWER";
    contract.stakeAsReviewer(2000);
    contract.createStudy(1, "Qm...", "Test Study", "Abstract");
    
    const result = contract.submitReview(1, 8, "Good work", false, "");
    expect(result.ok).toBe(true);
    expect(result.value).toBe(0);

    const study = contract.getStudy(1)!;
    expect(study.totalReviews).toBe(1);
    expect(study.avgScore).toBe(8);
    expect(study.aiFlags).toBe(0);

    const review = contract.getReview(1, "ST1REVIEWER")!;
    expect(review.score).toBe(8);
    expect(review.aiFlag).toBe(false);
  });

  it("rejects invalid score", () => {
    contract.caller = "ST1REVIEWER";
    contract.stakeAsReviewer(2000);
    contract.createStudy(1, "Qm...", "Test", "Abstract");
    
    const result = contract.submitReview(1, 11, "Comment", false, "");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_SCORE);
  });

  it("rejects insufficient stake", () => {
    contract.caller = "ST2REVIEWER";
    contract.stakeAsReviewer(500);
    contract.createStudy(1, "Qm...", "Test", "Abstract");
    
    const result = contract.submitReview(1, 8, "Comment", false, "");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INSUFFICIENT_STAKE);
  });

  it("rejects AI flag without evidence", () => {
    contract.caller = "ST1REVIEWER";
    contract.stakeAsReviewer(2000);
    contract.createStudy(1, "Qm...", "Test", "Abstract");
    
    const result = contract.submitReview(1, 8, "Comment", true, "");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_AI_FLAG_WITHOUT_EVIDENCE);
  });

  it("calculates aggregate score correctly", () => {
    contract.caller = "ST1AUTHOR";
    contract.createStudy(1, "Qm...", "Test", "Abstract");
    
    contract.caller = "ST1REVIEWER";
    contract.stakeAsReviewer(2000);
    contract.submitReview(1, 8, "Good", false, "");
    
    contract.caller = "ST2REVIEWER";
    contract.stakeAsReviewer(2000);
    contract.submitReview(1, 6, "Fair", false, "");
    
    expect(contract.getAggregateScore(1)).toBe(7);
  });

  it("flags AI error and triggers threshold", () => {
    contract.caller = "ST1AUTHOR";
    contract.createStudy(1, "Qm...", "Test", "Abstract");
    
    contract.caller = "ST1REVIEWER";
    contract.stakeAsReviewer(2000);
    contract.submitReview(1, 3, "AI detected", true, "QmEvidence...");
    
    contract.caller = "ST2REVIEWER";
    contract.stakeAsReviewer(2000);
    contract.submitReview(1, 2, "Fabricated data", true, "QmEvidence2...");
    
    expect(contract.getAiFlagPercentage(1)).toBe(100);
    
    contract.caller = "ST1AUTHOR";
    const closeResult = contract.closeReviewPeriod(1);
    expect(closeResult.ok).toBe(true);
    
    const study = contract.getStudy(1)!;
    expect(study.status).toBe(2);
    expect(study.accepted).toBe(false);
  });

  it("verifies AI flag as author", () => {
    contract.caller = "ST1AUTHOR";
    contract.createStudy(1, "Qm...", "Test", "Abstract");
    
    contract.caller = "ST1REVIEWER";
    contract.stakeAsReviewer(2000);
    contract.submitReview(1, 3, "AI?", true, "QmEvidence...");
    
    contract.caller = "ST1AUTHOR";
    const result = contract.verifyAiFlag(1, "ST1REVIEWER", true);
    expect(result.ok).toBe(true);
    
    const review = contract.getReview(1, "ST1REVIEWER")!;
    expect(review.verified).toBe(true);
  });

  it("rejects verification by non-author", () => {
    contract.caller = "ST2REVIEWER";
    contract.createStudy(1, "Qm...", "Test", "Abstract");
    
    const result = contract.verifyAiFlag(1, "ST1REVIEWER", true);
    expect(result.ok).toBe(false);
  });

  it("withdraws stake successfully", () => {
    contract.caller = "ST1REVIEWER";
    contract.stakeAsReviewer(2000);
    
    const result = contract.withdrawStake();
    expect(result.ok).toBe(true);
    expect(result.value).toBe(2000);
    
    expect(contract.state.reviewerStakes.has("ST1REVIEWER")).toBe(false);
  });

  it("rejects duplicate review", () => {
    contract.caller = "ST1REVIEWER";
    contract.stakeAsReviewer(2000);
    contract.createStudy(1, "Qm...", "Test", "Abstract");
    contract.submitReview(1, 8, "First", false, "");
    
    const result = contract.submitReview(1, 9, "Second", false, "");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_REVIEW_ALREADY_SUBMITTED);
  });

  it("closes period with acceptance", () => {
    contract.caller = "ST1AUTHOR";
    contract.createStudy(1, "Qm...", "Test", "Abstract");
    
    contract.caller = "ST1REVIEWER";
    contract.stakeAsReviewer(2000);
    contract.submitReview(1, 9, "Excellent", false, "");
    
    contract.caller = "ST1AUTHOR";
    const result = contract.closeReviewPeriod(1);
    expect(result.ok).toBe(true);
    
    const study = contract.getStudy(1)!;
    expect(study.status).toBe(1);
    expect(study.accepted).toBe(true);
  });

  it("uses Clarity types correctly", () => {
    const title = stringUtf8CV("Test Study");
    const ipfs = stringAsciiCV("Qm...");
    const score = uintCV(8);
    const flag = boolCV(false);
    
    expect(title.value).toBe("Test Study");
    expect(ipfs.value).toBe("Qm...");
    expect(Number(score.value)).toBe(8);
    expect(flag.type).toBe(ClarityType.BoolFalse);
  });
});