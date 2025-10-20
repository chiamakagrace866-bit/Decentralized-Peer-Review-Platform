import { describe, it, expect, beforeEach } from "vitest";
import { stringAsciiCV, stringUtf8CV, uintCV, listCV } from "@stacks/transactions";

const ERR_NOT_AUTHORIZED = 100;
const ERR_INVALID_IPFS_HASH = 101;
const ERR_INVALID_TITLE = 102;
const ERR_INVALID_ABSTRACT = 103;
const ERR_INVALID_CATEGORY = 104;
const ERR_INVALID_KEYWORDS = 105;
const ERR_STUDY_ALREADY_EXISTS = 106;
const ERR_STUDY_NOT_FOUND = 107;
const ERR_INVALID_FEE = 109;
const ERR_ARCHIVE_NOT_ALLOWED = 111;
const ERR_UPDATE_NOT_ALLOWED = 112;
const ERR_MAX_STUDIES_EXCEEDED = 114;
const ERR_INVALID_BOUNTY = 116;
const ERR_AUTHORITY_NOT_SET = 118;

interface Study {
  ipfsHash: string;
  title: string;
  abstract: string;
  category: string;
  keywords: string[];
  timestamp: number;
  author: string;
  version: number;
  status: string;
  bountyAmount: number;
}

interface StudyUpdate {
  updateTitle: string;
  updateAbstract: string;
  updateTimestamp: number;
  updater: string;
}

type Result<T> =
  | { ok: true; value: T }
  | { ok: false; value: number };

class SubmissionContractMock {
  state: {
    nextStudyId: number;
    maxStudies: number;
    submissionFee: number;
    bountyPool: string;
    authorityContract: string | null;
    studies: Map<number, Study>;
    studyUpdates: Map<number, StudyUpdate>;
    studiesByHash: Map<string, number>;
  } = {
    nextStudyId: 0,
    maxStudies: 10000,
    submissionFee: 500,
    bountyPool: "ST1TEST",
    authorityContract: null,
    studies: new Map(),
    studyUpdates: new Map(),
    studiesByHash: new Map(),
  };
  blockHeight: number = 0;
  caller: string = "ST1TEST";
  stxTransfers: Array<{ amount: number; from: string; to: string }> = [];

  constructor() {
    this.reset();
  }

  reset() {
    this.state = {
      nextStudyId: 0,
      maxStudies: 10000,
      submissionFee: 500,
      bountyPool: "ST1TEST",
      authorityContract: null,
      studies: new Map(),
      studyUpdates: new Map(),
      studiesByHash: new Map(),
    };
    this.blockHeight = 0;
    this.caller = "ST1TEST";
    this.stxTransfers = [];
  }

  setAuthorityContract(contractPrincipal: string): Result<boolean> {
    if (this.state.authorityContract !== null) {
      return { ok: false, value: ERR_AUTHORITY_NOT_SET };
    }
    this.state.authorityContract = contractPrincipal;
    return { ok: true, value: true };
  }

  setSubmissionFee(newFee: number): Result<boolean> {
    if (this.state.authorityContract === null) {
      return { ok: false, value: ERR_AUTHORITY_NOT_SET };
    }
    if (newFee < 0) {
      return { ok: false, value: ERR_INVALID_FEE };
    }
    this.state.submissionFee = newFee;
    return { ok: true, value: true };
  }

  setMaxStudies(newMax: number): Result<boolean> {
    if (this.state.authorityContract === null) {
      return { ok: false, value: ERR_AUTHORITY_NOT_SET };
    }
    if (newMax <= 0) {
      return { ok: false, value: ERR_MAX_STUDIES_EXCEEDED };
    }
    this.state.maxStudies = newMax;
    return { ok: true, value: true };
  }

  setBountyPool(newPool: string): Result<boolean> {
    if (this.state.authorityContract === null) {
      return { ok: false, value: ERR_AUTHORITY_NOT_SET };
    }
    this.state.bountyPool = newPool;
    return { ok: true, value: true };
  }

  submitStudy(
    ipfsHash: string,
    title: string,
    abstract: string,
    category: string,
    keywords: string[],
    bountyAmount: number
  ): Result<number> {
    if (this.state.nextStudyId >= this.state.maxStudies) {
      return { ok: false, value: ERR_MAX_STUDIES_EXCEEDED };
    }
    if (ipfsHash.length === 0 || ipfsHash.length > 46 || !ipfsHash.startsWith("Qm")) {
      return { ok: false, value: ERR_INVALID_IPFS_HASH };
    }
    if (title.length === 0 || title.length > 200) {
      return { ok: false, value: ERR_INVALID_TITLE };
    }
    if (abstract.length === 0 || abstract.length > 1000) {
      return { ok: false, value: ERR_INVALID_ABSTRACT };
    }
    if (category.length === 0 || category.length > 50) {
      return { ok: false, value: ERR_INVALID_CATEGORY };
    }
    if (keywords.length > 10 || keywords.some(kw => kw.length === 0 || kw.length > 50)) {
      return { ok: false, value: ERR_INVALID_KEYWORDS };
    }
    if (bountyAmount < 0) {
      return { ok: false, value: ERR_INVALID_BOUNTY };
    }
    if (this.state.studiesByHash.has(ipfsHash)) {
      return { ok: false, value: ERR_STUDY_ALREADY_EXISTS };
    }
    if (this.state.authorityContract === null) {
      return { ok: false, value: ERR_AUTHORITY_NOT_SET };
    }
    this.stxTransfers.push({ amount: this.state.submissionFee, from: this.caller, to: this.state.authorityContract });
    this.stxTransfers.push({ amount: bountyAmount, from: this.caller, to: this.state.bountyPool });
    const id = this.state.nextStudyId;
    const study: Study = {
      ipfsHash,
      title,
      abstract,
      category,
      keywords,
      timestamp: this.blockHeight,
      author: this.caller,
      version: 1,
      status: "active",
      bountyAmount,
    };
    this.state.studies.set(id, study);
    this.state.studiesByHash.set(ipfsHash, id);
    this.state.nextStudyId++;
    return { ok: true, value: id };
  }

  getStudy(id: number): Study | null {
    return this.state.studies.get(id) || null;
  }

  getStudyByHash(hash: string): Study | null {
    const id = this.state.studiesByHash.get(hash);
    return id !== undefined ? this.getStudy(id) : null;
  }

  updateStudy(id: number, newTitle: string, newAbstract: string): Result<boolean> {
    const study = this.state.studies.get(id);
    if (!study) {
      return { ok: false, value: ERR_STUDY_NOT_FOUND };
    }
    if (study.author !== this.caller) {
      return { ok: false, value: ERR_NOT_AUTHORIZED };
    }
    if (study.status !== "active") {
      return { ok: false, value: ERR_UPDATE_NOT_ALLOWED };
    }
    if (newTitle.length === 0 || newTitle.length > 200) {
      return { ok: false, value: ERR_INVALID_TITLE };
    }
    if (newAbstract.length === 0 || newAbstract.length > 1000) {
      return { ok: false, value: ERR_INVALID_ABSTRACT };
    }
    const updated: Study = {
      ...study,
      title: newTitle,
      abstract: newAbstract,
      timestamp: this.blockHeight,
      version: study.version + 1,
    };
    this.state.studies.set(id, updated);
    this.state.studyUpdates.set(id, {
      updateTitle: newTitle,
      updateAbstract: newAbstract,
      updateTimestamp: this.blockHeight,
      updater: this.caller,
    });
    return { ok: true, value: true };
  }

  archiveStudy(id: number): Result<boolean> {
    const study = this.state.studies.get(id);
    if (!study) {
      return { ok: false, value: ERR_STUDY_NOT_FOUND };
    }
    if (study.author !== this.caller) {
      return { ok: false, value: ERR_NOT_AUTHORIZED };
    }
    if (study.status !== "active") {
      return { ok: false, value: ERR_ARCHIVE_NOT_ALLOWED };
    }
    const updated: Study = {
      ...study,
      status: "archived",
    };
    this.state.studies.set(id, updated);
    return { ok: true, value: true };
  }

  getStudyCount(): Result<number> {
    return { ok: true, value: this.state.nextStudyId };
  }

  checkStudyExistence(hash: string): Result<boolean> {
    return { ok: true, value: this.state.studiesByHash.has(hash) };
  }
}

describe("SubmissionContract", () => {
  let contract: SubmissionContractMock;

  beforeEach(() => {
    contract = new SubmissionContractMock();
    contract.reset();
  });

  it("sets authority contract successfully", () => {
    const result = contract.setAuthorityContract("ST2TEST");
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    expect(contract.state.authorityContract).toBe("ST2TEST");
  });

  it("sets submission fee successfully", () => {
    contract.setAuthorityContract("ST2TEST");
    const result = contract.setSubmissionFee(1000);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    expect(contract.state.submissionFee).toBe(1000);
  });

  it("rejects submission fee change without authority", () => {
    const result = contract.setSubmissionFee(1000);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_AUTHORITY_NOT_SET);
  });

  it("sets max studies successfully", () => {
    contract.setAuthorityContract("ST2TEST");
    const result = contract.setMaxStudies(5000);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    expect(contract.state.maxStudies).toBe(5000);
  });

  it("sets bounty pool successfully", () => {
    contract.setAuthorityContract("ST2TEST");
    const result = contract.setBountyPool("ST3POOL");
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    expect(contract.state.bountyPool).toBe("ST3POOL");
  });

  it("submits a study successfully", () => {
    contract.setAuthorityContract("ST2TEST");
    const result = contract.submitStudy(
      "QmTestHash123456789012345678901234567890123456",
      "Test Title",
      "Test Abstract",
      "Science",
      ["key1", "key2"],
      200
    );
    expect(result.ok).toBe(true);
    expect(result.value).toBe(0);
    const study = contract.getStudy(0);
    expect(study?.ipfsHash).toBe("QmTestHash123456789012345678901234567890123456");
    expect(study?.title).toBe("Test Title");
    expect(study?.abstract).toBe("Test Abstract");
    expect(study?.category).toBe("Science");
    expect(study?.keywords).toEqual(["key1", "key2"]);
    expect(study?.author).toBe("ST1TEST");
    expect(study?.version).toBe(1);
    expect(study?.status).toBe("active");
    expect(study?.bountyAmount).toBe(200);
    expect(contract.stxTransfers).toEqual([
      { amount: 500, from: "ST1TEST", to: "ST2TEST" },
      { amount: 200, from: "ST1TEST", to: "ST1TEST" },
    ]);
  });

  it("rejects duplicate study hash", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.submitStudy(
      "QmTestHash",
      "Test Title",
      "Test Abstract",
      "Science",
      ["key1"],
      100
    );
    const result = contract.submitStudy(
      "QmTestHash",
      "Another Title",
      "Another Abstract",
      "Math",
      ["key2"],
      150
    );
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_STUDY_ALREADY_EXISTS);
  });

  it("rejects submission without authority", () => {
    const result = contract.submitStudy(
      "QmTestHash",
      "Test Title",
      "Test Abstract",
      "Science",
      ["key1"],
      100
    );
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_AUTHORITY_NOT_SET);
  });

  it("rejects invalid IPFS hash", () => {
    contract.setAuthorityContract("ST2TEST");
    const result = contract.submitStudy(
      "InvalidHash",
      "Test Title",
      "Test Abstract",
      "Science",
      ["key1"],
      100
    );
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_IPFS_HASH);
  });

  it("rejects invalid title", () => {
    contract.setAuthorityContract("ST2TEST");
    const result = contract.submitStudy(
      "QmTestHash",
      "",
      "Test Abstract",
      "Science",
      ["key1"],
      100
    );
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_TITLE);
  });

  it("rejects invalid abstract", () => {
    contract.setAuthorityContract("ST2TEST");
    const result = contract.submitStudy(
      "QmTestHash",
      "Test Title",
      "",
      "Science",
      ["key1"],
      100
    );
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_ABSTRACT);
  });

  it("rejects invalid category", () => {
    contract.setAuthorityContract("ST2TEST");
    const result = contract.submitStudy(
      "QmTestHash",
      "Test Title",
      "Test Abstract",
      "",
      ["key1"],
      100
    );
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_CATEGORY);
  });

  it("rejects invalid keywords", () => {
    contract.setAuthorityContract("ST2TEST");
    const result = contract.submitStudy(
      "QmTestHash",
      "Test Title",
      "Test Abstract",
      "Science",
      Array(11).fill("key"),
      100
    );
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_KEYWORDS);
  });

  it("updates a study successfully", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.submitStudy(
      "QmTestHash",
      "Old Title",
      "Old Abstract",
      "Science",
      ["key1"],
      100
    );
    const result = contract.updateStudy(0, "New Title", "New Abstract");
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    const study = contract.getStudy(0);
    expect(study?.title).toBe("New Title");
    expect(study?.abstract).toBe("New Abstract");
    expect(study?.version).toBe(2);
    const update = contract.state.studyUpdates.get(0);
    expect(update?.updateTitle).toBe("New Title");
    expect(update?.updateAbstract).toBe("New Abstract");
    expect(update?.updater).toBe("ST1TEST");
  });

  it("rejects update for non-existent study", () => {
    contract.setAuthorityContract("ST2TEST");
    const result = contract.updateStudy(99, "New Title", "New Abstract");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_STUDY_NOT_FOUND);
  });

  it("rejects update by non-author", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.submitStudy(
      "QmTestHash",
      "Test Title",
      "Test Abstract",
      "Science",
      ["key1"],
      100
    );
    contract.caller = "ST3FAKE";
    const result = contract.updateStudy(0, "New Title", "New Abstract");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_NOT_AUTHORIZED);
  });

  it("rejects update on archived study", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.submitStudy(
      "QmTestHash",
      "Test Title",
      "Test Abstract",
      "Science",
      ["key1"],
      100
    );
    contract.archiveStudy(0);
    const result = contract.updateStudy(0, "New Title", "New Abstract");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_UPDATE_NOT_ALLOWED);
  });

  it("archives a study successfully", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.submitStudy(
      "QmTestHash",
      "Test Title",
      "Test Abstract",
      "Science",
      ["key1"],
      100
    );
    const result = contract.archiveStudy(0);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    const study = contract.getStudy(0);
    expect(study?.status).toBe("archived");
  });

  it("rejects archive for non-existent study", () => {
    contract.setAuthorityContract("ST2TEST");
    const result = contract.archiveStudy(99);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_STUDY_NOT_FOUND);
  });

  it("rejects archive by non-author", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.submitStudy(
      "QmTestHash",
      "Test Title",
      "Test Abstract",
      "Science",
      ["key1"],
      100
    );
    contract.caller = "ST3FAKE";
    const result = contract.archiveStudy(0);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_NOT_AUTHORIZED);
  });

  it("rejects archive on already archived study", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.submitStudy(
      "QmTestHash",
      "Test Title",
      "Test Abstract",
      "Science",
      ["key1"],
      100
    );
    contract.archiveStudy(0);
    const result = contract.archiveStudy(0);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_ARCHIVE_NOT_ALLOWED);
  });

  it("gets study by hash successfully", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.submitStudy(
      "QmTestHash",
      "Test Title",
      "Test Abstract",
      "Science",
      ["key1"],
      100
    );
    const study = contract.getStudyByHash("QmTestHash");
    expect(study?.title).toBe("Test Title");
  });

  it("returns null for non-existent hash", () => {
    const study = contract.getStudyByHash("NonExistent");
    expect(study).toBeNull();
  });

  it("returns correct study count", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.submitStudy(
      "QmTest1",
      "Title1",
      "Abstract1",
      "Cat1",
      ["key1"],
      100
    );
    contract.submitStudy(
      "QmTest2",
      "Title2",
      "Abstract2",
      "Cat2",
      ["key2"],
      200
    );
    const result = contract.getStudyCount();
    expect(result.ok).toBe(true);
    expect(result.value).toBe(2);
  });

  it("checks study existence correctly", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.submitStudy(
      "QmTestHash",
      "Test Title",
      "Test Abstract",
      "Science",
      ["key1"],
      100
    );
    const result = contract.checkStudyExistence("QmTestHash");
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    const result2 = contract.checkStudyExistence("NonExistent");
    expect(result2.ok).toBe(true);
    expect(result2.value).toBe(false);
  });

  it("rejects submission with max studies exceeded", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.state.maxStudies = 1;
    contract.submitStudy(
      "QmTest1",
      "Title1",
      "Abstract1",
      "Cat1",
      ["key1"],
      100
    );
    const result = contract.submitStudy(
      "QmTest2",
      "Title2",
      "Abstract2",
      "Cat2",
      ["key2"],
      200
    );
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_MAX_STUDIES_EXCEEDED);
  });

  it("parses study parameters with Clarity types", () => {
    const hash = stringAsciiCV("QmTestHash");
    const title = stringUtf8CV("Test Title");
    const keywords = listCV([stringUtf8CV("key1"), stringUtf8CV("key2")]);
    const bounty = uintCV(100);
    expect(hash.value).toBe("QmTestHash");
    expect(title.value).toBe("Test Title");
    expect(keywords.value).toHaveLength(2);
    expect(bounty.value).toEqual(BigInt(100));
  });
});