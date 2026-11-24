declare module 'node:test' {
  export function describe(name: string, fn: () => void): void;
  export function it(name: string, fn: () => void): void;
  export function test(name: string, fn: () => void): void;
}

declare module 'node:assert/strict' {
  export function equal<T>(actual: unknown, expected: T, message?: string): asserts actual is T;
  export function notEqual(actual: unknown, expected: unknown, message?: string): void;
  export function deepEqual<T>(actual: unknown, expected: T, message?: string): asserts actual is T;
  export function ok(value: unknown, message?: string): asserts value;
  export function match(string: string, regexp: RegExp, message?: string): void;
}
