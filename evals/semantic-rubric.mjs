import promptfoo from 'promptfoo';

export const judge = 'openai:responses:gpt-6.2-sol';
const provider = {
  id: judge,
  config: {
    store: false, omitDefaults: true, reasoning: { effort: 'medium' }, max_output_tokens: 1000,
    response_format: { type: 'json_schema', json_schema: {
      name: 'summary_verdict', strict: true, schema: {
        type: 'object', additionalProperties: false,
        properties: { pass: { type: 'boolean' }, reason: { type: 'string' } },
        required: ['pass', 'reason'],
      },
    } },
  },
};

export async function gradeRubric(rubric, summary, rubricPrompt) {
  const result = await promptfoo.assertions.matchesLlmRubric(rubric, summary, { provider, rubricPrompt }, {}, undefined, { throwOnError: true });
  if (!result.metadata?.renderedGradingPrompt) throw Error('No valid judge verdict: ' + result.reason);
  return { verdict: { pass: result.pass, score: result.score, reason: result.reason }, tokenUsage: result.tokensUsed };
}
