import { audit, modelToll, tenant } from '../access.mjs'
import { body, send } from '../http.mjs'
import { agentAvailable, agentModel, runWorkspaceAgentTurn } from '../workspaceAgentModel.mjs'

/**
 * The agent inside a workspace: /api/agent/status and /api/agent/:workspaceId/turn.
 *
 * Unlike the interview, this call belongs to a workspace that already exists, so it carries the
 * workspace token like every other workspace endpoint and is refused without one. It costs money,
 * so it pays the same model toll the interview does.
 *
 * Nothing here executes anything. The turn returns a decision and either an action or a plan, and
 * the workspace applies it through the path it always has — role check, approval where the change
 * warrants one, a versioned build that is tested before it is promoted, and rollback if it was
 * wrong. A model deciding and a workspace changing stay two separate events on purpose.
 */

/** Everything the caller sends reaches a model, so it is clipped and filtered rather than trusted. */
function contextFrom(value) {
  const input = value && typeof value === 'object' ? value : {}
  const text = (candidate, limit) => String(candidate ?? '').slice(0, limit)
  return {
    company: {
      name: text(input.company?.name, 120),
      industry: text(input.company?.industry, 120),
      description: text(input.company?.description, 600),
    },
    actingAgent: input.actingAgent && typeof input.actingAgent === 'object'
      ? { label: text(input.actingAgent.label, 80), permissions: (Array.isArray(input.actingAgent.permissions) ? input.actingAgent.permissions : []).slice(0, 20).map(item => text(item, 40)) }
      : null,
    modules: (Array.isArray(input.modules) ? input.modules : []).slice(0, 40).map(item => text(item, 40)),
    activeCapabilities: (Array.isArray(input.activeCapabilities) ? input.activeCapabilities : []).slice(0, 200).map(item => text(item, 80)),
    /** id=label lines, built by the client from the catalog it owns, so the two never drift. */
    catalog: text(input.catalog, 20000),
    entities: (Array.isArray(input.entities) ? input.entities : []).slice(0, 60).map(entity => ({
      id: text(entity?.id, 60),
      label: text(entity?.label, 60),
      pluralLabel: text(entity?.pluralLabel, 60),
      primaryField: text(entity?.primaryField, 60),
      fields: (Array.isArray(entity?.fields) ? entity.fields : []).slice(0, 40).map(field => ({
        id: text(field?.id, 60),
        label: text(field?.label, 80),
        type: text(field?.type, 20),
        ...(Array.isArray(field?.options) && field.options.length ? { options: field.options.slice(0, 12).map(option => text(option, 40)) } : {}),
        ...(field?.relationEntityId ? { relationEntityId: text(field.relationEntityId, 60) } : {}),
      })),
    })),
    navigation: (Array.isArray(input.navigation) ? input.navigation : []).slice(0, 60).map(item => ({ id: text(item?.id, 60), label: text(item?.label, 60), kind: text(item?.kind, 20) })),
    workflows: (Array.isArray(input.workflows) ? input.workflows : []).slice(0, 40).map(item => ({ id: text(item?.id, 80), name: text(item?.name, 120), entityId: text(item?.trigger?.entityId ?? item?.entityId, 60) })),
    records: (Array.isArray(input.records) ? input.records : []).slice(0, 80).map(item => ({
      entityId: text(item?.entityId, 60),
      id: text(item?.id, 80),
      label: text(item?.label, 120),
      ...(item?.status === undefined ? {} : { status: text(item.status, 60) }),
      ...(item?.amount === undefined ? {} : { amount: Number(item.amount) || 0 }),
      ...(item?.dueDate === undefined ? {} : { dueDate: text(item.dueDate, 40) }),
    })),
  }
}

export async function agentRoutes(request, response, segments) {
  if (segments[1] !== 'agent') return false

  if (request.method === 'GET' && segments[2] === 'status') {
    return send(response, 200, { available: agentAvailable(), model: agentModel() })
  }

  if (request.method === 'POST' && segments[2] && segments[3] === 'turn') {
    const workspaceId = segments[2]
    await tenant(request, workspaceId)
    const toll = modelToll(request)
    if (toll) return send(response, toll.status, { error: toll.error })
    const input = await body(request)
    const command = String(input.command ?? '').trim().slice(0, 1000)
    if (!command) return send(response, 400, { error: 'A command is required.' })
    const mode = input.mode === 'build' ? 'build' : 'command'
    const turn = await runWorkspaceAgentTurn({ mode, command, context: contextFrom(input.context) })
    // What the agent decided, kept whether or not the operator goes on to apply it: a proposal
    // nobody accepted is part of the account of what happened in a workspace.
    await audit(workspaceId, 'agent.turn', request, { mode, decision: String(turn.decision ?? ''), model: turn.model })
    return send(response, 200, turn)
  }

  return send(response, 405, { error: 'Method not allowed.' })
}
