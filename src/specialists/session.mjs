import OpenAI from 'openai';

export async function runAgentSession(
  { agent, request, schema, tools, invoke, model, effort, metadata },
  client = new OpenAI({ maxRetries: 0 }),
) {
  const started = Date.now();
  const sessions = client.beta.agents.sessions;
  const params = {
    agent: {
      model,
      instructions: agent.instructions,
      reasoning: { effort },
      tools: tools.map(({ strict, ...definition }) => definition),
      text: { format: { type: 'json_schema', schema } },
    },
    environment: { type: 'none' },
    input: request,
    stream: true,
  };
  const stream = await sessions.create(params, { timeout: 180000 });
  const replies = new Map();
  let terminal, text;
  async function respond(actions) {
    const events = [];
    for (const action of actions ?? []) {
      if (action.type !== 'function_call' || (metadata.turnId && action.turn_id !== metadata.turnId))
        throw Error('Unexpected required action');
      metadata.turnId ??= action.turn_id;
      let reply = replies.get(action.call_id);
      if (!reply) {
        reply = { type: 'agent.session.input.tool_result', turn_id: action.turn_id, call_id: action.call_id };
        try {
          reply.output = JSON.stringify(await invoke(action.name, action.arguments));
          reply.success = true;
        } catch (err) {
          reply.success = false;
          reply.error = err.message;
        }
        replies.set(action.call_id, reply);
      }
      events.push(reply);
    }
    if (events.length) await sessions.events.create(metadata.sessionId, { events });
  }
  let checkpoint = '';
  try {
    try {
      for await (const event of stream) {
        metadata.sessionId ??= event.session_id ?? event.session?.id;
        metadata.turnId ??= event.turn_id;
        const ids = [metadata.sessionId, metadata.turnId].join('/');
        if (metadata.checkpoint && ids !== checkpoint) {
          await metadata.checkpoint(metadata);
          checkpoint = ids;
        }
        if (event.turn_id && metadata.turnId !== event.turn_id) continue;
        if (event.type === 'agent.session.requires_action') await respond(event.session.required_actions);
        if (
          event.type === 'agent.session.turn.item.done' &&
          event.item?.role === 'assistant' &&
          event.item.phase !== 'commentary'
        ) {
          text = event.item.content
            .filter((part) => part.type === 'output_text')
            .map((part) => part.text)
            .join('');
        }
        if (
          [
            'agent.session.turn.completed',
            'agent.session.turn.failed',
            'agent.session.turn.cancelled',
          ].includes(event.type)
        ) {
          terminal = event.turn;
          metadata.usage = event.usage ?? terminal.usage;
          break;
        }
      }
    } catch (err) {
      if (!metadata.sessionId || !metadata.turnId) throw err;
      metadata.streamInterrupted = true;
    }
    if (!terminal && metadata.turnId) {
      const deadline = started + 180000;
      while (Date.now() < deadline) {
        const saved = await sessions.turns.retrieve(metadata.turnId, { session_id: metadata.sessionId });
        if (['completed', 'failed', 'cancelled'].includes(saved.status)) {
          terminal = saved;
          break;
        }
        const session = await sessions.retrieve(metadata.sessionId);
        await respond(session.required_actions ?? []);
        await new Promise((resolve) => setTimeout(resolve, 800));
      }
    }
    metadata.usage ??= terminal?.usage ?? null;
    metadata.turnElapsedMs = Date.now() - started;
    // Terminal events often precede usage accounting. Reconcile against the persistent turn.
    if (terminal?.status === 'completed' && !metadata.usage) {
      for (const delay of [0, 750, 1500, 3000]) {
        if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
        try {
          metadata.usage = (
            await sessions.turns.retrieve(metadata.turnId, { session_id: metadata.sessionId })
          ).usage;
        } catch {
          break;
        }
        if (metadata.usage) break;
      }
    }
    if (terminal?.status !== 'completed')
      throw Error(
        'Agent turn ' + (terminal?.status ?? 'interrupted') + ' ' + (terminal?.error?.message ?? ''),
      );
    metadata.accountingMs = Date.now() - started - metadata.turnElapsedMs;
    if (!text) {
      for await (const item of sessions.turns.items.list(metadata.turnId, {
        session_id: metadata.sessionId,
        order: 'asc',
      })) {
        if (
          item.turn_id === metadata.turnId &&
          item.type === 'message' &&
          item.role === 'assistant' &&
          item.phase !== 'commentary'
        ) {
          const content = item.content
            .filter((part) => part.type === 'output_text')
            .map((part) => part.text)
            .join('');
          if (content) text = content;
        }
      }
    }
    if (!text) throw Error('Completed turn has no final answer');
    return JSON.parse(text);
  } finally {
    stream.controller.abort();
  }
}
