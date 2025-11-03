// tests/ai-error-mitigation.test.ts

import { describe, it, expect, beforeEach, vi } from "vitest";
import { Cl } from "@stacks/transactions";

const ERR_NOT_AUTHORIZED = 100;
const ERR_STUDY_NOT_FOUND = 101;
const ERR_ALREADY_FLAGGED = 102;
const ERR_FLAG_THRESHOLD_NOT_MET = 103;
const ERR_REVIEW_PERIOD_ENDED = 105;
const ERR_STAKE_INSUFFICIENT = 107;
const ERR_ORACLE_NOT_SET = 108;
const ERR_MAX_FLAGS_EXCEEDED = 112;
const ERR_SECONDARY_ROUND_NOT_ACTIVE = 111;
const ERR_INVALID_EVIDENCE = 109;
const ERR_SECONDARY_ROUND_ACTIVE = 110;
const ERR_VERIFICATION_FAILED = 106;
const ERR_PENALTY_ALREADY_APPLIED = 114;
const ERR_INVALID_VERIFIER = 113;

interface StudyFlags {
  "flag-count": bigint;
  "flagged-by": string[];
  "evidence-hashes": string[];
  escalated: boolean;
  "secondary-active": boolean;
  "secondary-verifiers": string[];
  "verification-passed": bigint | null;
  "penalty-applied": boolean;
}

class AIErrorMitigationMock {
  state: {
    oracle: string | null;
    reviewContract: string;
    submissionContract: string;
    tokenContract: string;
    studyFlags: Map<bigint, StudyFlags>;
    reviewerStake: Map<string, bigint>;
    studyReviewWindow: Map<bigint, bigint>;
    blockHeight: bigint;
    caller: string;
    transfers: Array<{ token: string; amount: bigint; from: string; to: string }>;
    submissionCalls: Array<{ method: string; args: any[] }>;
  };

  constructor() {
    this.reset();
  }

  reset() {
    this.state = {
      oracle: null,
      reviewContract: "SP000000000000000000002Q6VF78.review",
      submissionContract: "SP000000000000000000002Q6VF78.submission",
      tokenContract: "SP000000000000000000002Q6VF78.token",
      studyFlags: new Map(),
      reviewerStake: new Map(),
      studyReviewWindow: new Map(),
      blockHeight: 100n,
      caller: "ST1TEST",
      transfers: [],
      submissionCalls: [],
    };
  }

  setCaller(caller: string) {
    this.state.caller = caller;
  }

  advanceBlocks(n: bigint) {
    this.state.blockHeight += n;
  }

  get blockHeight() {
    return this.state.blockHeight;
  }

  setOracle(newOracle: string): { ok: boolean; value: boolean } {
    if (this.state.oracle === null) {
      return { ok: false, value: false };
    }
    if (this.state.caller !== this.state.oracle) {
      return { ok: false, value: false };
    }
    this.state.oracle = newOracle;
    return { ok: true, value: true };
  }

  stakeForReview(amount: bigint): { ok: boolean; value: boolean | string } {
    if (amount < 1000000n) {
      return { ok: false, value: false };
    }
    const current = this.state.reviewerStake.get(this.state.caller) || 0n;
    this.state.reviewerStake.set(this.state.caller, current + amount);
    this.state.transfers.push({
      token: this.state.tokenContract,
      amount,
      from: this.state.caller,
      to: "contract",
    });
    return { ok: true, value: true };
  }

  unstakeForReview(amount: bigint): { ok: boolean; value: boolean | string } {
    const current = this.state.reviewerStake.get(this.state.caller) || 0n;
    if (current < amount) {
      return { ok: false, value: false };
    }
    this.state.reviewerStake.set(this.state.caller, current - amount);
    this.state.transfers.push({
      token: this.state.tokenContract,
      amount,
      from: "contract",
      to: this.state.caller,
    });
    return { ok: true, value: true };
  }

  setReviewWindow(studyId: bigint, endBlock: bigint): { ok: boolean; value: boolean | string } {
    if (this.state.caller !== this.state.reviewContract) {
      return { ok: false, value: false };
    }
    this.state.studyReviewWindow.set(studyId, endBlock);
    return { ok: true, value: true };
  }

  getTotalReviewers(studyId: bigint): bigint {
    return 10n;
  }

  getStudyAuthor(studyId: bigint): string {
    return "ST1AUTHOR";
  }

  flagAiError(studyId: bigint, evidenceHash: string): { ok: boolean; value: boolean | string } {
    const reviewEnd = this.state.studyReviewWindow.get(studyId);
    if (reviewEnd === undefined) {
      return { ok: false, value: ERR_STUDY_NOT_FOUND };
    }
    if (this.blockHeight > reviewEnd) {
      return { ok: false, value: ERR_REVIEW_PERIOD_ENDED };
    }
    const stake = this.state.reviewerStake.get(this.state.caller) || 0n;
    if (stake < 1000000n) {
      return { ok: false, value: ERR_STAKE_INSUFFICIENT };
    }

    let flags = this.state.studyFlags.get(studyId) || {
      "flag-count": 0n,
      "flagged-by": [],
      "evidence-hashes": [],
      escalated: false,
      "secondary-active": false,
      "secondary-verifiers": [],
      "verification-passed": null,
      "penalty-applied": false,
    };

    if (flags["flagged-by"].includes(this.state.caller)) {
      return { ok: false, value: ERR_ALREADY_FLAGGED };
    }
    if (flags["flag-count"] >= 50n) {
      return { ok: false, value: ERR_MAX_FLAGS_EXCEEDED };
    }
    if (evidenceHash.length === 0 || evidenceHash.length > 64) {
      return { ok: false, value: ERR_INVALID_EVIDENCE };
    }

    const totalReviewers = this.getTotalReviewers(studyId);
    const threshold = (totalReviewers * 20n) / 100n;

    flags["flag-count"] += 1n;
    flags["flagged-by"].push(this.state.caller);
    flags["evidence-hashes"].push(evidenceHash);

    const escalated = flags["flag-count"] >= threshold;
    if (escalated && !flags.escalated) {
      flags.escalated = true;
      flags["secondary-active"] = true;
      flags["secondary-verifiers"] = [];
      this.state.transfers.push({
        token: this.state.tokenContract,
        amount: 500000n,
        from: this.state.caller,
        to: "contract",
      });
    }

    this.state.studyFlags.set(studyId, flags);
    return { ok: true, value: escalated };
  }

  registerAsVerifier(studyId: bigint): { ok: boolean; value: boolean | string } {
    const flags = this.state.studyFlags.get(studyId);
    if (!flags) {
      return { ok: false, value: ERR_STUDY_NOT_FOUND };
    }
    if (!flags["secondary-active"]) {
      return { ok: false, value: ERR_SECONDARY_ROUND_NOT_ACTIVE };
    }
    const stake = this.state.reviewerStake.get(this.state.caller) || 0n;
    if (stake < 1000000n) {
      return { ok: false, value: ERR_STAKE_INSUFFICIENT };
    }
    if (flags["secondary-verifiers"].length >= 20) {
      return { ok: false, value: ERR_INVALID_VERIFIER };
    }
    if (flags["secondary-verifiers"].includes(this.state.caller)) {
      return { ok: false, value: ERR_ALREADY_FLAGGED };
    }

    flags["secondary-verifiers"].push(this.state.caller);
    this.state.studyFlags.set(studyId, flags);
    return { ok: true, value: true };
  }

  submitVerification(studyId: bigint, isAiError: boolean, justification: string): { ok: boolean; value: boolean | string } {
    const flags = this.state.studyFlags.get(studyId);
    if (!flags) {
      return { ok: false, value: ERR_STUDY_NOT_FOUND };
    }
    if (!flags["secondary-active"]) {
      return { ok: false, value: ERR_SECONDARY_ROUND_NOT_ACTIVE };
    }
    if (!flags["secondary-verifiers"].includes(this.state.caller)) {
      return { ok: false, value: ERR_NOT_AUTHORIZED };
    }
    if (justification.length === 0) {
      return { ok: false, value: ERR_INVALID_EVIDENCE };
    }

    flags["verification-passed"] = isAiError ? 1n : 0n;
    flags["secondary-active"] = false;

    if (isAiError) {
      if (flags["penalty-applied"]) {
        return { ok: false, value: ERR_PENALTY_ALREADY_APPLIED };
      }
      const author = this.getStudyAuthor(studyId);
      const authorStake = this.state.reviewerStake.get(author) || 0n;
      if (authorStake === 0n) {
        return { ok: false, value: ERR_STAKE_INSUFFICIENT };
      }
      const slash = (authorStake * 50n) / 100n;
      this.state.reviewerStake.set(author, authorStake - slash);
      flags["penalty-applied"] = true;
      this.state.transfers.push({
        token: this.state.tokenContract,
        amount: slash,
        from: author,
        to: "contract",
      });
    }

    this.state.studyFlags.set(studyId, flags);
    return { ok: true, value: true };
  }

  getStudyFlags(studyId: bigint): StudyFlags | null {
    return this.state.studyFlags.get(studyId) || null;
  }

  getReviewerStake(reviewer: string): bigint {
    return this.state.reviewerStake.get(reviewer) || 0n;
  }

  isEscalated(studyId: bigint): { ok: boolean; value: boolean } {
    const flags = this.state.studyFlags.get(studyId) || { escalated: false };
    return { ok: true, value: flags.escalated };
  }

  getTotalFlags(studyId: bigint): { ok: boolean; value: bigint } {
    const flags = this.state.studyFlags.get(studyId) || { "flag-count": 0n };
    return { ok: true, value: flags["flag-count"] };
  }
}

describe("AIErrorMitigation", () => {
  let contract: AIErrorMitigationMock;

  beforeEach(() => {
    contract = new AIErrorMitigationMock();
    contract.reset();
  });

  it("sets oracle successfully by initial authority", () => {
    contract.setCaller("initial-oracle");
    contract.state.oracle = "initial-oracle";
    const result = contract.setOracle("new-oracle");
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    expect(contract.state.oracle).toBe("new-oracle");
  });

  it("rejects oracle change by non-authority", () => {
    contract.setCaller("initial-oracle");
    contract.state.oracle = "initial-oracle";
    contract.setOracle("valid-oracle");
    contract.setCaller("attacker");
    const result = contract.setOracle("hacked-oracle");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(false);
  });

  it("rejects setting oracle without initial authority", () => {
    contract.setCaller("unauthorized");
    const result = contract.setOracle("new-oracle");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(false);
  });

  it("allows staking for review with sufficient amount", () => {
    const result = contract.stakeForReview(2000000n);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    expect(contract.getReviewerStake("ST1TEST")).toBe(2000000n);
    expect(contract.state.transfers.length).toBe(1);
    expect(contract.state.transfers[0]).toEqual({
      token: "SP000000000000000000002Q6VF78.token",
      amount: 2000000n,
      from: "ST1TEST",
      to: "contract",
    });
  });

  it("rejects staking below minimum amount", () => {
    const result = contract.stakeForReview(500000n);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(false);
    expect(contract.getReviewerStake("ST1TEST")).toBe(0n);
  });

  it("allows unstaking partial amount", () => {
    contract.stakeForReview(2000000n);
    const result = contract.unstakeForReview(1000000n);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    expect(contract.getReviewerStake("ST1TEST")).toBe(1000000n);
    expect(contract.state.transfers.length).toBe(2);
    expect(contract.state.transfers[1]).toEqual({
      token: "SP000000000000000000002Q6VF78.token",
      amount: 1000000n,
      from: "contract",
      to: "ST1TEST",
    });
  });

  it("rejects unstaking more than staked", () => {
    contract.stakeForReview(1000000n);
    const result = contract.unstakeForReview(1500000n);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(false);
    expect(contract.getReviewerStake("ST1TEST")).toBe(1000000n);
  });

  it("sets review window by review contract", () => {
    contract.setCaller("SP000000000000000000002Q6VF78.review");
    const result = contract.setReviewWindow(1n, 200n);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    expect(contract.state.studyReviewWindow.get(1n)).toBe(200n);
  });

  it("rejects setting review window by unauthorized caller", () => {
    contract.setCaller("ST1TEST");
    const result = contract.setReviewWindow(1n, 200n);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(false);
  });

  it("flags AI error successfully within period", () => {
    contract.stakeForReview(1000000n);
    contract.setCaller("SP000000000000000000002Q6VF78.review");
    contract.setReviewWindow(1n, 150n);
    contract.setCaller("ST1TEST");
    const result = contract.flagAiError(1n, "hash123456789012345678901234567890123456789012345678901234567890");
    expect(result.ok).toBe(true);
    expect(result.value).toBe(false);
    const flags = contract.getStudyFlags(1n);
    expect(flags).not.toBeNull();
    expect(flags!["flag-count"]).toBe(1n);
    expect(flags!["flagged-by"]).toContain("ST1TEST");
    expect(flags!["evidence-hashes"]).toContain("hash123456789012345678901234567890123456789012345678901234567890");
  });

  it("escalates to secondary review at 20% threshold", () => {
    contract.setCaller("SP000000000000000000002Q6VF78.review");
    contract.setReviewWindow(1n, 150n);
    for (let i = 0; i < 2; i++) {
      contract.setCaller(`ST${i}TEST`);
      contract.stakeForReview(1000000n);
      const result = contract.flagAiError(1n, `hash${i}`);
      expect(result.ok).toBe(true);
    }
    const flags = contract.getStudyFlags(1n);
    expect(flags!.escalated).toBe(true);
    expect(flags!["secondary-active"]).toBe(true);
    expect(contract.state.transfers.length).toBe(3); // 2 stakes + 1 bounty
    expect(contract.state.transfers[2].amount).toBe(500000n);
  });

  it("prevents flagging after review period ends", () => {
    contract.stakeForReview(1000000n);
    contract.setCaller("SP000000000000000000002Q6VF78.review");
    contract.setReviewWindow(1n, 50n);
    contract.advanceBlocks(60n);
    contract.setCaller("ST1TEST");
    const result = contract.flagAiError(1n, "hash123");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_REVIEW_PERIOD_ENDED);
  });

  it("rejects flagging without sufficient stake", () => {
    contract.setCaller("SP000000000000000000002Q6VF78.review");
    contract.setReviewWindow(1n, 150n);
    contract.setCaller("ST1TEST");
    const result = contract.flagAiError(1n, "hash123");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_STAKE_INSUFFICIENT);
  });

  it("rejects duplicate flagging by same reviewer", () => {
    contract.stakeForReview(1000000n);
    contract.setCaller("SP000000000000000000002Q6VF78.review");
    contract.setReviewWindow(1n, 150n);
    contract.setCaller("ST1TEST");
    contract.flagAiError(1n, "hash123");
    const result = contract.flagAiError(1n, "hash456");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_ALREADY_FLAGGED);
  });

  it("rejects flagging with invalid evidence hash length", () => {
    contract.stakeForReview(1000000n);
    contract.setCaller("SP000000000000000000002Q6VF78.review");
    contract.setReviewWindow(1n, 150n);
    contract.setCaller("ST1TEST");
    const result = contract.flagAiError(1n, "");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_EVIDENCE);
    const resultLong = contract.flagAiError(1n, "a".repeat(65));
    expect(resultLong.ok).toBe(false);
    expect(resultLong.value).toBe(ERR_INVALID_EVIDENCE);
  });

  it("rejects flagging when max flags exceeded", () => {
    contract.stakeForReview(1000000n);
    contract.setCaller("SP000000000000000000002Q6VF78.review");
    contract.setReviewWindow(1n, 150n);
    for (let i = 0; i < 50; i++) {
      contract.setCaller(`ST${i}TEST`);
      contract.stakeForReview(1000000n);
      contract.flagAiError(1n, `hash${i}`);
    }
    contract.setCaller("ST50TEST");
    contract.stakeForReview(1000000n);
    const result = contract.flagAiError(1n, "hash51");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_MAX_FLAGS_EXCEEDED);
  });

  it("registers verifier successfully in active secondary round", () => {
    contract.setCaller("SP000000000000000000002Q6VF78.review");
    contract.setReviewWindow(1n, 150n);
    contract.setCaller("ST1TEST");
    contract.stakeForReview(1000000n);
    contract.flagAiError(1n, "hash123");
    contract.setCaller("ST2TEST");
    contract.stakeForReview(1000000n);
    contract.flagAiError(1n, "hash456");
    const flagsBefore = contract.getStudyFlags(1n);
    expect(flagsBefore!.escalated).toBe(true);
    contract.setCaller("verifier1");
    contract.stakeForReview(1000000n);
    const result = contract.registerAsVerifier(1n);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    const flagsAfter = contract.getStudyFlags(1n);
    expect(flagsAfter!["secondary-verifiers"]).toContain("verifier1");
    expect(flagsAfter!["secondary-verifiers"].length).toBe(1);
  });

  it("rejects verifier registration without secondary active", () => {
    contract.setCaller("SP000000000000000000002Q6VF78.review");
    contract.setReviewWindow(1n, 150n);
    contract.setCaller("reviewer1");
    contract.stakeForReview(1000000n);
    contract.flagAiError(1n, "hash123");
    contract.setCaller("verifier1");
    contract.stakeForReview(1000000n);
    const result = contract.registerAsVerifier(1n);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_SECONDARY_ROUND_NOT_ACTIVE);
  });

  it("rejects verifier registration with insufficient stake", () => {
    contract.setCaller("SP000000000000000000002Q6VF78.review");
    contract.setReviewWindow(1n, 150n);
    contract.setCaller("ST1TEST");
    contract.stakeForReview(1000000n);
    contract.flagAiError(1n, "hash123");
    contract.setCaller("ST2TEST");
    contract.stakeForReview(1000000n);
    contract.flagAiError(1n, "hash456");
    contract.setCaller("verifier1");
    const result = contract.registerAsVerifier(1n);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_STAKE_INSUFFICIENT);
  });

  it("rejects duplicate verifier registration", () => {
    contract.setCaller("SP000000000000000000002Q6VF78.review");
    contract.setReviewWindow(1n, 150n);
    contract.setCaller("ST1TEST");
    contract.stakeForReview(1000000n);
    contract.flagAiError(1n, "hash123");
    contract.setCaller("ST2TEST");
    contract.stakeForReview(1000000n);
    contract.flagAiError(1n, "hash456");
    contract.setCaller("verifier1");
    contract.stakeForReview(1000000n);
    contract.registerAsVerifier(1n);
    const result = contract.registerAsVerifier(1n);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_ALREADY_FLAGGED);
  });

  it("rejects verifier registration when max verifiers reached", () => {
    contract.setCaller("SP000000000000000000002Q6VF78.review");
    contract.setReviewWindow(1n, 150n);
    contract.setCaller("ST1TEST");
    contract.stakeForReview(1000000n);
    contract.flagAiError(1n, "hash123");
    contract.setCaller("ST2TEST");
    contract.stakeForReview(1000000n);
    contract.flagAiError(1n, "hash456");
    for (let i = 0; i < 20; i++) {
      contract.setCaller(`verifier${i}`);
      contract.stakeForReview(1000000n);
      contract.registerAsVerifier(1n);
    }
    contract.setCaller("verifier20");
    contract.stakeForReview(1000000n);
    const result = contract.registerAsVerifier(1n);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_VERIFIER);
  });

  it("submits verification successfully confirming AI error and applies penalty", () => {
    contract.setCaller("ST1AUTHOR");
    contract.stakeForReview(2000000n);
    contract.setCaller("SP000000000000000000002Q6VF78.review");
    contract.setReviewWindow(1n, 150n);
    contract.setCaller("ST1TEST");
    contract.stakeForReview(1000000n);
    contract.flagAiError(1n, "hash123");
    contract.setCaller("ST2TEST");
    contract.stakeForReview(1000000n);
    contract.flagAiError(1n, "hash456");
    contract.setCaller("verifier1");
    contract.stakeForReview(1000000n);
    contract.registerAsVerifier(1n);
    const result = contract.submitVerification(1n, true, "Evidence of hallucination");
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    expect(contract.getReviewerStake("ST1AUTHOR")).toBe(1000000n);
    const flags = contract.getStudyFlags(1n);
    expect(flags!["verification-passed"]).toBe(1n);
    expect(flags!["secondary-active"]).toBe(false);
    expect(flags!["penalty-applied"]).toBe(true);
    expect(contract.state.transfers.length).toBe(6); // stakes + flags + bounty + penalty transfer
    expect(contract.state.transfers[5].amount).toBe(1000000n);
    expect(contract.state.transfers[5].from).toBe("ST1AUTHOR");
  });

  it("submits verification successfully denying AI error without penalty", () => {
    contract.setCaller("SP000000000000000000002Q6VF78.review");
    contract.setReviewWindow(1n, 150n);
    contract.setCaller("ST1TEST");
    contract.stakeForReview(1000000n);
    contract.flagAiError(1n, "hash123");
    contract.setCaller("ST2TEST");
    contract.stakeForReview(1000000n);
    contract.flagAiError(1n, "hash456");
    contract.setCaller("verifier1");
    contract.stakeForReview(1000000n);
    contract.registerAsVerifier(1n);
    const result = contract.submitVerification(1n, false, "No AI issues found");
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    expect(contract.getReviewerStake("ST1AUTHOR")).toBe(0n);
    const flags = contract.getStudyFlags(1n);
    expect(flags!["verification-passed"]).toBe(0n);
    expect(flags!["secondary-active"]).toBe(false);
    expect(flags!["penalty-applied"]).toBe(false);
  });

  it("rejects verification submission by non-verifier", () => {
    contract.setCaller("SP000000000000000000002Q6VF78.review");
    contract.setReviewWindow(1n, 150n);
    contract.setCaller("ST1TEST");
    contract.stakeForReview(1000000n);
    contract.flagAiError(1n, "hash123");
    contract.setCaller("ST2TEST");
    contract.stakeForReview(1000000n);
    contract.flagAiError(1n, "hash456");
    contract.setCaller("non-verifier");
    contract.stakeForReview(1000000n);
    const result = contract.submitVerification(1n, true, "Invalid");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_NOT_AUTHORIZED);
  });

  it("rejects verification with empty justification", () => {
    contract.setCaller("SP000000000000000000002Q6VF78.review");
    contract.setReviewWindow(1n, 150n);
    contract.setCaller("ST1TEST");
    contract.stakeForReview(1000000n);
    contract.flagAiError(1n, "hash123");
    contract.setCaller("ST2TEST");
    contract.stakeForReview(1000000n);
    contract.flagAiError(1n, "hash456");
    contract.setCaller("verifier1");
    contract.stakeForReview(1000000n);
    contract.registerAsVerifier(1n);
    const result = contract.submitVerification(1n, true, "");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_EVIDENCE);
  });

  it("rejects verification when secondary round not active", () => {
    contract.setCaller("SP000000000000000000002Q6VF78.review");
    contract.setReviewWindow(1n, 150n);
    contract.setCaller("reviewer1");
    contract.stakeForReview(1000000n);
    contract.flagAiError(1n, "hash123");
    contract.setCaller("verifier1");
    contract.stakeForReview(1000000n);
    const result = contract.submitVerification(1n, true, "Test");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_SECONDARY_ROUND_NOT_ACTIVE);
  });

  it("prevents double penalty application", () => {
    contract.setCaller("ST1AUTHOR");
    contract.stakeForReview(2000000n);
    contract.setCaller("SP000000000000000000002Q6VF78.review");
    contract.setReviewWindow(1n, 150n);
    contract.setCaller("ST1TEST");
    contract.stakeForReview(1000000n);
    contract.flagAiError(1n, "hash123");
    contract.setCaller("ST2TEST");
    contract.stakeForReview(1000000n);
    contract.flagAiError(1n, "hash456");
    contract.setCaller("verifier1");
    contract.stakeForReview(1000000n);
    contract.registerAsVerifier(1n);
    contract.submitVerification(1n, true, "Penalty applied");
    const flags = contract.getStudyFlags(1n);
    if (flags) {
      flags["secondary-active"] = true;
    }
    const result = contract.submitVerification(1n, true, "Double penalty attempt");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_PENALTY_ALREADY_APPLIED);
    expect(contract.getReviewerStake("ST1AUTHOR")).toBe(1000000n);
  });

  it("rejects penalty on author with no stake", () => {
    contract.setCaller("SP000000000000000000002Q6VF78.review");
    contract.setReviewWindow(1n, 150n);
    contract.setCaller("ST1TEST");
    contract.stakeForReview(1000000n);
    contract.flagAiError(1n, "hash123");
    contract.setCaller("ST2TEST");
    contract.stakeForReview(1000000n);
    contract.flagAiError(1n, "hash456");
    contract.setCaller("verifier1");
    contract.stakeForReview(1000000n);
    contract.registerAsVerifier(1n);
    const result = contract.submitVerification(1n, true, "No stake");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_STAKE_INSUFFICIENT);
  });

  it("returns correct escalation status", () => {
    contract.setCaller("SP000000000000000000002Q6VF78.review");
    contract.setReviewWindow(1n, 150n);
    const result = contract.isEscalated(1n);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(false);
    contract.setCaller("ST1TEST");
    contract.stakeForReview(1000000n);
    contract.flagAiError(1n, "hash123");
    contract.setCaller("ST2TEST");
    contract.stakeForReview(1000000n);
    contract.flagAiError(1n, "hash456");
    const escalatedResult = contract.isEscalated(1n);
    expect(escalatedResult.ok).toBe(true);
    expect(escalatedResult.value).toBe(true);
  });

  it("returns correct total flags count", () => {
    contract.setCaller("SP000000000000000000002Q6VF78.review");
    contract.setReviewWindow(1n, 150n);
    contract.setCaller("ST1TEST");
    contract.stakeForReview(1000000n);
    contract.flagAiError(1n, "hash123");
    const result = contract.getTotalFlags(1n);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(1n);
    contract.setCaller("ST2TEST");
    contract.stakeForReview(1000000n);
    contract.flagAiError(1n, "hash456");
    const totalResult = contract.getTotalFlags(1n);
    expect(totalResult.ok).toBe(true);
    expect(totalResult.value).toBe(2n);
  });

  it("handles non-existent study gracefully", () => {
    const flagsResult = contract.getStudyFlags(999n);
    expect(flagsResult).toBeNull();
    const escalatedResult = contract.isEscalated(999n);
    expect(escalatedResult.value).toBe(false);
    const totalFlagsResult = contract.getTotalFlags(999n);
    expect(totalFlagsResult.value).toBe(0n);
  });
});