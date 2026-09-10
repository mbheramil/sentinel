// Step IR schema and compiler — §8.2
export type { Step, Target, Assertion, ValueRef, StepIr, CompileResult, CompileWarning } from './types.js';
export { StepSchema, StepIrSchema, ValueRefSchema, TargetSchema, AssertionSchema } from './schema.js';
export { compile } from './compiler.js';
