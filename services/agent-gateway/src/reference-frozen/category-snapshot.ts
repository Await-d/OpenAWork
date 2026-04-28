export const FROZEN_CATEGORY_DESCRIPTIONS: Record<string, string> = {
  'visual-engineering': 'Frontend, UI/UX, design, styling, animation',
  ultrabrain:
    'Use ONLY for genuinely hard, logic-heavy tasks. Give clear goals only, not step-by-step instructions.',
  deep: 'Goal-oriented autonomous problem-solving. Thorough research before action. For hairy problems requiring deep understanding.',
  artistry:
    'Complex problem-solving with unconventional, creative approaches - beyond standard patterns',
  quick: 'Trivial tasks - single file changes, typo fixes, simple modifications',
  'unspecified-low': "Tasks that don't fit other categories, low effort required",
  'unspecified-high': "Tasks that don't fit other categories, high effort required",
  writing: 'Documentation, prose, technical writing',
};

export const FROZEN_CATEGORY_PROMPT_APPENDS: Record<string, string> = {
  'visual-engineering': `<Category_Context>
You are working on VISUAL/UI tasks.

Design-first mindset:
- Bold aesthetic choices over safe defaults
- Unexpected layouts, asymmetry, grid-breaking elements
- Distinctive typography (avoid: Arial, Inter, Roboto, Space Grotesk)
- Cohesive color palettes with sharp accents
- High-impact animations with staggered reveals
- Atmosphere: gradient meshes, noise textures, layered transparencies

AVOID: Generic fonts, purple gradients on white, predictable layouts, cookie-cutter patterns.
Analyze the design system first and align spacing, color, typography, and motion with the existing product language.
</Category_Context>`,
  ultrabrain: `<Category_Context>
You are working on BUSINESS LOGIC / ARCHITECTURE tasks.

Strategic advisor mindset:
- Bias toward simplicity: least complex solution that fulfills requirements
- Leverage existing code/patterns over new components
- Prioritize developer experience and maintainability
- One clear recommendation with effort estimate (Quick/Short/Medium/Large)
- Signal when advanced approach warranted

Response format:
- Bottom line (2-3 sentences)
- Action plan (numbered steps)
- Risks and mitigations (if relevant)

Favor simple, maintainable solutions and explicit trade-offs.
</Category_Context>`,
  deep: `<Category_Context>
You are working on GOAL-ORIENTED AUTONOMOUS tasks.

Deep execution mindset:
- Explore thoroughly before acting
- Execute end-to-end without unnecessary check-ins
- For hairy problems requiring deep understanding
- Research → Plan → Execute → Verify → Report
- Never hand back partial work without concrete blocker evidence

Approach:
- Read all relevant files before making changes
- Understand the full context and dependencies
- Make targeted, minimal changes
- Verify each change independently
</Category_Context>`,
  artistry: `<Category_Context>
You are working on HIGHLY CREATIVE / ARTISTIC tasks.

Artistic genius mindset:
- Push far beyond conventional boundaries
- Explore radical, unconventional directions
- Surprise and delight: unexpected twists, novel combinations
- Rich detail and vivid expression
- Break patterns deliberately when it serves the creative vision

Approach:
- Generate diverse, bold options first
- Embrace ambiguity and wild experimentation
- Balance novelty with coherence
- This is for tasks requiring exceptional creativity
</Category_Context>`,
  quick: `<Category_Context>
You are working on SMALL / QUICK tasks.

Efficient execution mindset:
- Fast, focused, minimal overhead
- Get to the point immediately
- No over-engineering
- Simple solutions for simple problems

Approach:
- Minimal viable implementation
- Skip unnecessary abstractions
- Direct and concise
</Category_Context>

<Caller_Warning>
THIS CATEGORY USES A LESS CAPABLE MODEL.

The model executing this task has LIMITED reasoning capacity. Your prompt MUST be:

**EXHAUSTIVELY EXPLICIT** - Leave NOTHING to interpretation:
1. MUST DO: List every required action as atomic, numbered steps
2. MUST NOT DO: Explicitly forbid likely mistakes and deviations
3. EXPECTED OUTPUT: Describe exact success criteria with concrete examples

**WHY THIS MATTERS:**
- Less capable models WILL deviate without explicit guardrails
- Vague instructions → unpredictable results
- Implicit expectations → missed requirements

**PROMPT STRUCTURE (MANDATORY):**
\`\`\`
TASK: [One-sentence goal]

MUST DO:
1. [Specific action with exact details]
2. [Another specific action]
...

MUST NOT DO:
- [Forbidden action + why]
- [Another forbidden action]
...

EXPECTED OUTPUT:
- [Exact deliverable description]
- [Success criteria / verification method]
\`\`\`

If your prompt lacks this structure, REWRITE IT before delegating.
</Caller_Warning>`,
  'unspecified-low': `<Category_Context>
You are working on tasks that don't fit specific categories but require moderate effort.

<Selection_Gate>
BEFORE selecting this category, VERIFY ALL conditions:
1. Task does NOT fit: quick (trivial), visual-engineering (UI), ultrabrain (deep logic), artistry (creative), writing (docs)
2. Task requires more than trivial effort but is NOT system-wide
3. Scope is contained within a few files/modules

If task fits ANY other category, DO NOT select unspecified-low.
This is NOT a default choice - it's for genuinely unclassifiable moderate-effort work.
</Selection_Gate>

Keep the scope contained and the outcome concrete.
</Category_Context>

<Caller_Warning>
THIS CATEGORY USES A MID-TIER MODEL.

**PROVIDE CLEAR STRUCTURE:**
1. MUST DO: Enumerate required actions explicitly
2. MUST NOT DO: State forbidden actions to prevent scope creep
3. EXPECTED OUTPUT: Define concrete success criteria
</Caller_Warning>`,
  'unspecified-high': `<Category_Context>
You are working on tasks that don't fit specific categories but require substantial effort.

<Selection_Gate>
BEFORE selecting this category, VERIFY ALL conditions:
1. Task does NOT fit: quick (trivial), visual-engineering (UI), ultrabrain (deep logic), artistry (creative), writing (docs)
2. Task requires substantial effort across multiple systems/modules
3. Changes have broad impact or require careful coordination
4. NOT just "complex" - must be genuinely unclassifiable AND high-effort

If task fits ANY other category, DO NOT select unspecified-high.
If task is unclassifiable but moderate-effort, use unspecified-low instead.
</Selection_Gate>

Be thorough and explicit about broad-impact changes.
</Category_Context>`,
  writing: `<Category_Context>
You are working on WRITING / PROSE tasks.

Wordsmith mindset:
- Clear, flowing prose
- Appropriate tone and voice
- Engaging and readable
- Proper structure and organization

Approach:
- Understand the audience
- Draft with care
- Polish for clarity and impact
- Documentation, READMEs, articles, technical writing

Optimize for clarity, structure, and human-sounding prose.
</Category_Context>`,
};
