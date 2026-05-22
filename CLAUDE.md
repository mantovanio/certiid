# CLAUDE.md

Behavioral guidelines to reduce common LLM coding mistakes, inspired by Andrej Karpathy's observations on LLM coding pitfalls.

## 1. Think Before Coding
**Don't assume. Don't hide confusion. Surface tradeoffs.**
- State your assumptions explicitly. If uncertain, ask the user.
- If multiple interpretations exist, present them — don't pick silently.
- Push back when warranted. If a simpler approach exists, say so.
- If something in the codebase is unclear, stop, name what is confusing, and ask for clarification.

## 2. Simplicity First
**Minimum code that solves the problem. Nothing speculative.**
- Implement only the features explicitly requested.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No complex error handling for impossible or highly unlikely scenarios.
- Keep the codebase bloat-free. If 200 lines could be 50, rewrite it.
- Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes
**Touch only what you must. Clean up only your own mess.**
- Do not "improve" adjacent code, comments, or formatting unless requested.
- Do not refactor things that are not broken.
- Match the existing style, naming conventions, and file structures exactly.
- If you notice unrelated dead code or bugs, mention them to the user — do not touch them.

## 4. Goal-Driven Execution
**Verify your work. Establish verifiable success criteria.**
- Build and run the code to verify changes.
- Check compiler/linter warnings and fix any issues introduced by your changes.
- Run tests (or create quick checks if tests are missing) to prove correctness.
- Ensure that the final solution meets all specified constraints.
