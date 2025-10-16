import { BigNumber } from "ethers";
import { toPlainObject } from "./misc";

describe("toPlainObject", () => {
  it("should convert BigNumber to string", () => {
    const input = BigNumber.from("1000000000000000000"); // 1 ETH in wei
    const result = toPlainObject(input);
    expect(result).toBe("1000000000000000000");
  });

  it("should handle objects with BigNumber properties", () => {
    const input = {
      maxFeePerGas: BigNumber.from("20000000000"),
      maxPriorityFeePerGas: BigNumber.from("2000000000"),
      value: BigNumber.from("1000000000000000000"),
    };
    const result = toPlainObject(input);
    expect(result).toEqual({
      maxFeePerGas: "20000000000",
      maxPriorityFeePerGas: "2000000000",
      value: "1000000000000000000",
    });
  });

  it("should handle nested objects with BigNumbers", () => {
    const input = {
      transaction: {
        gasPrice: BigNumber.from("30000000000"),
        value: BigNumber.from("500000000000000000"),
      },
      metadata: {
        timestamp: 1234567890,
        blockNumber: 12345,
      },
    };
    const result = toPlainObject(input);
    expect(result).toEqual({
      transaction: {
        gasPrice: "30000000000",
        value: "500000000000000000",
      },
      metadata: {
        timestamp: 1234567890,
        blockNumber: 12345,
      },
    });
  });

  it("should handle arrays of BigNumbers", () => {
    const input = [
      BigNumber.from("100"),
      BigNumber.from("200"),
      BigNumber.from("300"),
    ];
    const result = toPlainObject(input);
    expect(result).toEqual(["100", "200", "300"]);
  });

  it("should handle arrays of objects with BigNumbers", () => {
    const input = [
      { amount: BigNumber.from("100"), name: "token1" },
      { amount: BigNumber.from("200"), name: "token2" },
    ];
    const result = toPlainObject(input);
    expect(result).toEqual([
      { amount: "100", name: "token1" },
      { amount: "200", name: "token2" },
    ]);
  });

  it("should preserve primitive values", () => {
    const input = {
      string: "hello",
      number: 42,
      boolean: true,
      nullValue: null,
      undefinedValue: undefined,
    };
    const result = toPlainObject(input);
    expect(result).toEqual({
      string: "hello",
      number: 42,
      boolean: true,
      nullValue: null,
      undefinedValue: undefined,
    });
  });

  it("should handle mixed objects with BigNumbers and primitives", () => {
    const input = {
      address: "0x1234567890123456789012345678901234567890",
      balance: BigNumber.from("1000000000000000000"),
      decimals: 18,
      symbol: "ETH",
      isActive: true,
    };
    const result = toPlainObject(input);
    expect(result).toEqual({
      address: "0x1234567890123456789012345678901234567890",
      balance: "1000000000000000000",
      decimals: 18,
      symbol: "ETH",
      isActive: true,
    });
  });

  it("should handle null and undefined inputs", () => {
    expect(toPlainObject(null)).toBeNull();
    expect(toPlainObject(undefined)).toBeUndefined();
  });

  it("should handle empty objects and arrays", () => {
    expect(toPlainObject({})).toEqual({});
    expect(toPlainObject([])).toEqual([]);
  });

  it("should handle deeply nested structures", () => {
    const input = {
      level1: {
        level2: {
          level3: {
            amount: BigNumber.from("999"),
            data: [BigNumber.from("111"), { nested: BigNumber.from("222") }],
          },
        },
      },
    };
    const result = toPlainObject(input);
    expect(result).toEqual({
      level1: {
        level2: {
          level3: {
            amount: "999",
            data: ["111", { nested: "222" }],
          },
        },
      },
    });
  });
});
