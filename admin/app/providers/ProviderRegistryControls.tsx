import {
  createProviderRegistryAction,
  createProviderStrategyGroupAction,
  deleteProviderRegistryAction,
  probeProviderRegistryHealthAction,
  runProviderSandboxTestCallAction,
  updateProviderRegistryAction,
  updateProviderStrategyGroupAction
} from "./actions";
import type { ProviderRegistryEntry, ProviderRegistrySource, ProviderStrategyGroup } from "@/lib/types";

export function ProviderRegistryControls({
  items,
  strategyGroups,
  source,
  createState,
  updateState,
  deleteState,
  healthProbeState,
  updateProviderID,
  testState,
  testProviderID,
  strategyCreateState,
  strategyUpdateState
}: {
  items: ProviderRegistryEntry[];
  strategyGroups: ProviderStrategyGroup[];
  source: ProviderRegistrySource;
  createState?: string;
  updateState?: string;
  deleteState?: string;
  healthProbeState?: string;
  updateProviderID?: string;
  testState?: string;
  testProviderID?: string;
  strategyCreateState?: string;
  strategyUpdateState?: string;
}) {
  const live = source === "api";
  const defaultPrimaryProvider = items[0]?.provider_id ?? "";
  const defaultFallbackProvider = items[1]?.provider_id ?? items[0]?.provider_id ?? "";
  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <h3>Provider Routing Controls</h3>
          <p>Status, traffic weight, canary, concurrency, fallback, and kill switch updates are audited by the backend.</p>
        </div>
      </div>
      <div className="panel-body">
        {createState ? (
          <p className={createState === "saved" ? "notice success" : "notice warning"}>
            {createState === "saved"
              ? `Created provider registry entry${updateProviderID ? ` for ${updateProviderID}` : ""}.`
              : `Provider registry create ${createState}${updateProviderID ? ` for ${updateProviderID}` : ""}.`}
          </p>
        ) : null}
        {updateState ? (
          <p className={updateState === "saved" ? "notice success" : "notice warning"}>
            {updateState === "saved"
              ? `Saved provider registry update${updateProviderID ? ` for ${updateProviderID}` : ""}.`
              : `Provider registry update ${updateState}${updateProviderID ? ` for ${updateProviderID}` : ""}.`}
          </p>
        ) : null}
        {deleteState ? (
          <p className={deleteState === "saved" ? "notice success" : "notice warning"}>
            {deleteState === "saved"
              ? `Deleted provider registry entry${updateProviderID ? ` for ${updateProviderID}` : ""}.`
              : `Provider registry delete ${deleteState}${updateProviderID ? ` for ${updateProviderID}` : ""}.`}
          </p>
        ) : null}
        {healthProbeState ? (
          <p className={healthProbeState === "saved" ? "notice success" : "notice warning"}>
            {healthProbeState === "saved"
              ? `Provider health probe completed${updateProviderID ? ` for ${updateProviderID}` : ""}.`
              : `Provider health probe ${healthProbeState}${updateProviderID ? ` for ${updateProviderID}` : ""}.`}
          </p>
        ) : null}
        {testState ? (
          <p className={testState === "saved" ? "notice success" : "notice warning"}>
            {testState === "saved"
              ? `Provider sandbox test call completed${testProviderID ? ` for ${testProviderID}` : ""}.`
              : `Provider sandbox test call ${testState}${testProviderID ? ` for ${testProviderID}` : ""}.`}
          </p>
        ) : null}
        {strategyCreateState ? (
          <p className={strategyCreateState === "saved" ? "notice success" : "notice warning"}>
            {strategyCreateState === "saved"
              ? `Created provider strategy group${updateProviderID ? ` for ${updateProviderID}` : ""}.`
              : `Provider strategy group create ${strategyCreateState}${updateProviderID ? ` for ${updateProviderID}` : ""}.`}
          </p>
        ) : null}
        {strategyUpdateState ? (
          <p className={strategyUpdateState === "saved" ? "notice success" : "notice warning"}>
            {strategyUpdateState === "saved"
              ? `Saved provider strategy group${updateProviderID ? ` for ${updateProviderID}` : ""}.`
              : `Provider strategy group update ${strategyUpdateState}${updateProviderID ? ` for ${updateProviderID}` : ""}.`}
          </p>
        ) : null}
        {!live ? <p className="notice warning">Live provider registry API is unavailable; fixture fallback is read-only.</p> : null}
        <form className="provider-control provider-create" action={createProviderStrategyGroupAction}>
          <div className="provider-control-title span-full">
            <strong>Create Strategy Group</strong>
            <span>Define provider routing membership, failover, canary, and concurrency for a tool surface.</span>
          </div>
          <label>
            Group ID
            <input name="group_id" defaultValue="image-generation-default" disabled={!live} />
          </label>
          <label>
            Display name
            <input name="strategy_display_name" defaultValue="Image generation default" disabled={!live} />
          </label>
          <label>
            Tool type
            <input name="strategy_tool_type" defaultValue="generate" disabled={!live} />
          </label>
          <label>
            Status
            <select name="strategy_status" defaultValue="enabled" disabled={!live}>
              <option value="enabled">enabled</option>
              <option value="disabled">disabled</option>
              <option value="kill_switch">kill_switch</option>
            </select>
          </label>
          <label>
            Selection policy
            <select name="selection_policy" defaultValue="weighted" disabled={!live}>
              <option value="weighted">weighted</option>
              <option value="priority">priority</option>
              <option value="canary">canary</option>
              <option value="failover">failover</option>
            </select>
          </label>
          <label>
            Fallback providers
            <input name="strategy_fallback_provider_ids" defaultValue={defaultFallbackProvider} disabled={!live} />
          </label>
          <label className="span-full">
            Member provider IDs
            <input name="member_provider_ids" defaultValue={[defaultPrimaryProvider, defaultFallbackProvider].filter(Boolean).join(", ")} disabled={!live} />
          </label>
          <label>
            Member 1 weight
            <input name="member_0_weight" type="number" min="0" defaultValue={90} disabled={!live} />
          </label>
          <label>
            Member 1 canary %
            <input name="member_0_canary_percent" type="number" min="0" max="100" defaultValue={10} disabled={!live} />
          </label>
          <label>
            Member 1 concurrency
            <input name="member_0_max_concurrency" type="number" min="0" defaultValue={4} disabled={!live} />
          </label>
          <label>
            Member 1 fallback rank
            <input name="member_0_fallback_rank" type="number" min="0" defaultValue={0} disabled={!live} />
          </label>
          <label>
            Member 2 weight
            <input name="member_1_weight" type="number" min="0" defaultValue={10} disabled={!live} />
          </label>
          <label>
            Member 2 canary %
            <input name="member_1_canary_percent" type="number" min="0" max="100" defaultValue={0} disabled={!live} />
          </label>
          <label>
            Member 2 concurrency
            <input name="member_1_max_concurrency" type="number" min="0" defaultValue={1} disabled={!live} />
          </label>
          <label>
            Member 2 fallback rank
            <input name="member_1_fallback_rank" type="number" min="0" defaultValue={1} disabled={!live} />
          </label>
          <label>
            Routing surface
            <input name="strategy_metadata_surface" defaultValue="batch_generation" disabled={!live} />
          </label>
          <label className="checkbox-row">
            <input name="strategy_kill_switch" type="checkbox" disabled={!live} />
            Kill switch group
          </label>
          <label className="checkbox-row">
            <input name="member_0_enabled" type="checkbox" defaultChecked disabled={!live} />
            Member 1 enabled
          </label>
          <label className="checkbox-row">
            <input name="member_1_enabled" type="checkbox" defaultChecked disabled={!live} />
            Member 2 enabled
          </label>
          <label className="span-full">
            Rationale
            <textarea name="strategy_rationale" required={live} minLength={1} placeholder="Operational reason for creating this strategy group" disabled={!live} />
          </label>
          <button className="button" type="submit" disabled={!live}>
            Create Strategy Group
          </button>
        </form>
        <div className="provider-control-grid">
          {strategyGroups.map((group) => {
            const firstMember = group.members[0];
            const secondMember = group.members[1];
            return (
              <form key={group.group_id} className="provider-control" action={updateProviderStrategyGroupAction}>
                <input type="hidden" name="group_id" value={group.group_id} />
                <div className="provider-control-title">
                  <strong>{group.display_name}</strong>
                  <span className="mono">{group.group_id}</span>
                </div>
                <label>
                  Display name
                  <input name="strategy_display_name" defaultValue={group.display_name} disabled={!live} />
                </label>
                <label>
                  Tool type
                  <input name="strategy_tool_type" defaultValue={group.tool_type} disabled={!live} />
                </label>
                <label>
                  Status
                  <select name="strategy_status" defaultValue={group.status} disabled={!live}>
                    <option value="enabled">enabled</option>
                    <option value="disabled">disabled</option>
                    <option value="kill_switch">kill_switch</option>
                  </select>
                </label>
                <label>
                  Selection policy
                  <select name="selection_policy" defaultValue={group.selection_policy} disabled={!live}>
                    <option value="weighted">weighted</option>
                    <option value="priority">priority</option>
                    <option value="canary">canary</option>
                    <option value="failover">failover</option>
                  </select>
                </label>
                <label className="span-full">
                  Fallback providers
                  <input name="strategy_fallback_provider_ids" defaultValue={(group.fallback_provider_ids ?? []).join(", ")} disabled={!live} />
                </label>
                <label className="span-full">
                  Member provider IDs
                  <input name="member_provider_ids" defaultValue={group.members.map((member) => member.provider_id).join(", ")} disabled={!live} />
                </label>
                <label>
                  Member 1 weight
                  <input name="member_0_weight" type="number" min="0" defaultValue={firstMember?.weight ?? 0} disabled={!live || !firstMember} />
                </label>
                <label>
                  Member 1 canary %
                  <input name="member_0_canary_percent" type="number" min="0" max="100" defaultValue={firstMember?.canary_percent ?? 0} disabled={!live || !firstMember} />
                </label>
                <label>
                  Member 1 concurrency
                  <input name="member_0_max_concurrency" type="number" min="0" defaultValue={firstMember?.max_concurrency ?? 0} disabled={!live || !firstMember} />
                </label>
                <label>
                  Member 1 fallback rank
                  <input name="member_0_fallback_rank" type="number" min="0" defaultValue={firstMember?.fallback_rank ?? 0} disabled={!live || !firstMember} />
                </label>
                <label>
                  Member 2 weight
                  <input name="member_1_weight" type="number" min="0" defaultValue={secondMember?.weight ?? 0} disabled={!live || !secondMember} />
                </label>
                <label>
                  Member 2 canary %
                  <input name="member_1_canary_percent" type="number" min="0" max="100" defaultValue={secondMember?.canary_percent ?? 0} disabled={!live || !secondMember} />
                </label>
                <label>
                  Member 2 concurrency
                  <input name="member_1_max_concurrency" type="number" min="0" defaultValue={secondMember?.max_concurrency ?? 0} disabled={!live || !secondMember} />
                </label>
                <label>
                  Member 2 fallback rank
                  <input name="member_1_fallback_rank" type="number" min="0" defaultValue={secondMember?.fallback_rank ?? 0} disabled={!live || !secondMember} />
                </label>
                <label>
                  Routing surface
                  <input name="strategy_metadata_surface" defaultValue={group.metadata?.routing_surface ?? "batch_generation"} disabled={!live} />
                </label>
                <label className="checkbox-row">
                  <input name="strategy_kill_switch" type="checkbox" defaultChecked={group.kill_switch} disabled={!live} />
                  Kill switch group
                </label>
                <label className="checkbox-row">
                  <input name="member_0_enabled" type="checkbox" defaultChecked={firstMember?.enabled ?? false} disabled={!live || !firstMember} />
                  Member 1 enabled
                </label>
                <label className="checkbox-row">
                  <input name="member_1_enabled" type="checkbox" defaultChecked={secondMember?.enabled ?? false} disabled={!live || !secondMember} />
                  Member 2 enabled
                </label>
                <label className="span-full">
                  Rationale
                  <textarea name="strategy_rationale" required={live} minLength={1} placeholder="Operational reason for audit" disabled={!live} />
                </label>
                <button className="button" type="submit" disabled={!live}>
                  Save Strategy Group
                </button>
              </form>
            );
          })}
        </div>
        <form className="provider-control provider-create" action={createProviderRegistryAction}>
          <div className="provider-control-title span-full">
            <strong>Create Provider Registry Entry</strong>
            <span>Add a provider with initial routing, health, capability, cost, and batch metadata.</span>
          </div>
          <label>
            Provider ID
            <input name="provider_id" placeholder="zenari-video-sandbox" disabled={!live} />
          </label>
          <label>
            Display name
            <input name="display_name" placeholder="Zenari video sandbox" disabled={!live} />
          </label>
          <label>
            Mode
            <select name="mode" defaultValue="sandbox" disabled={!live}>
              <option value="dev">dev</option>
              <option value="sandbox">sandbox</option>
              <option value="production">production</option>
            </select>
          </label>
          <label>
            Status
            <select name="status" defaultValue="disabled" disabled={!live}>
              <option value="enabled">enabled</option>
              <option value="disabled">disabled</option>
              <option value="kill_switch">kill_switch</option>
            </select>
          </label>
          <label className="span-full">
            Secret reference
            <input name="secret_ref" placeholder="secrets/provider/zenari-video-sandbox" disabled={!live} />
          </label>
          <label>
            Weight
            <input name="weight" type="number" min="0" defaultValue={0} disabled={!live} />
          </label>
          <label>
            Canary %
            <input name="canary_percent" type="number" min="0" max="100" defaultValue={0} disabled={!live} />
          </label>
          <label>
            Max concurrency
            <input name="max_concurrency" type="number" min="0" defaultValue={1} disabled={!live} />
          </label>
          <label>
            Fallback providers
            <input name="fallback_provider_ids" placeholder="dev, zenari-image-sandbox" disabled={!live} />
          </label>
          <label>
            Latency ms
            <input name="latency_ms" type="number" min="0" defaultValue={0} disabled={!live} />
          </label>
          <label>
            Error rate %
            <input name="error_rate_percent" type="number" min="0" max="100" defaultValue={0} disabled={!live} />
          </label>
          <label>
            Region
            <input name="metadata_region" placeholder="sandbox-us" disabled={!live} />
          </label>
          <label>
            Health message
            <input name="health_message" placeholder="staged for sandbox verification" disabled={!live} />
          </label>
          <div className="provider-control-title span-full">
            <strong>Initial Capability and Cost</strong>
            <span>Model capability is required before the provider can be selected by batch routing.</span>
          </div>
          <label>
            Model
            <input name="model_id" placeholder="video-fast-v1" disabled={!live} />
          </label>
          <label>
            Endpoints
            <input name="endpoints" placeholder="video.generate" disabled={!live} />
          </label>
          <label>
            Input types
            <input name="input_types" defaultValue="prompt" disabled={!live} />
          </label>
          <label>
            Output types
            <input name="output_types" placeholder="video" disabled={!live} />
          </label>
          <label>
            Tool types
            <input name="tool_types" placeholder="generate" disabled={!live} />
          </label>
          <label>
            Cost currency
            <input name="cost_currency" defaultValue="USD" disabled={!live} />
          </label>
          <label>
            Max cost units
            <input name="max_cost_units" type="number" min="0" defaultValue={0} disabled={!live} />
          </label>
          <label>
            Estimated cents
            <input name="estimated_cost_cents" type="number" min="0" defaultValue={0} disabled={!live} />
          </label>
          <label>
            Max batch size
            <input name="max_batch_size" type="number" min="1" defaultValue={1} disabled={!live} />
          </label>
          <label>
            Aspect ratios
            <input name="supported_aspect_ratios" placeholder="1:1, 16:9" disabled={!live} />
          </label>
          <label className="span-full">
            Qualities
            <input name="supported_qualities" placeholder="draft, standard" disabled={!live} />
          </label>
          <label className="checkbox-row">
            <input name="health_available" type="checkbox" disabled={!live} />
            Health available
          </label>
          <label className="checkbox-row">
            <input name="kill_switch" type="checkbox" disabled={!live} />
            Kill switch
          </label>
          <label className="checkbox-row">
            <input name="supports_batch" type="checkbox" disabled={!live} />
            Supports batch
          </label>
          <label className="checkbox-row">
            <input name="supports_seed" type="checkbox" disabled={!live} />
            Supports seed
          </label>
          <label className="checkbox-row">
            <input name="supports_cancel" type="checkbox" disabled={!live} />
            Supports cancel
          </label>
          <label className="span-full">
            Rationale
            <textarea name="rationale" required={live} minLength={1} placeholder="Operational reason for creating this provider" disabled={!live} />
          </label>
          <button className="button" type="submit" disabled={!live}>
            Create Provider
          </button>
        </form>
        <div className="provider-control-grid">
          {items.map((item) => {
            const firstCapability = item.capabilities[0];
            const defaultTool = firstCapability?.tool_types?.[0] ?? firstCapability?.endpoints?.[0] ?? "image.generate";
            return (
              <div key={item.provider_id} className="provider-control-stack">
                <form className="provider-control" action={updateProviderRegistryAction}>
                  <input type="hidden" name="provider_id" value={item.provider_id} />
                  <div className="provider-control-title">
                    <strong>{item.display_name}</strong>
                    <span className="mono">{item.provider_id}</span>
                  </div>
                  <label className="span-full">
                    Secret reference
                    <input name="secret_ref" defaultValue={item.secret_ref ?? ""} placeholder="secrets/provider/name" disabled={!live} />
                  </label>
                  <label>
                    Status
                    <select name="status" defaultValue={item.status} disabled={!live}>
                      <option value="enabled">enabled</option>
                      <option value="disabled">disabled</option>
                      <option value="kill_switch">kill_switch</option>
                    </select>
                  </label>
                  <label>
                    Weight
                    <input name="weight" type="number" min="0" defaultValue={item.routing.weight} disabled={!live} />
                  </label>
                  <label>
                    Canary %
                    <input name="canary_percent" type="number" min="0" max="100" defaultValue={item.routing.canary_percent} disabled={!live} />
                  </label>
                  <label>
                    Max concurrency
                    <input name="max_concurrency" type="number" min="0" defaultValue={item.routing.max_concurrency} disabled={!live} />
                  </label>
                  <label>
                    Fallback providers
                    <input name="fallback_provider_ids" defaultValue={(item.routing.fallback_provider_ids ?? []).join(", ")} disabled={!live} />
                  </label>
                  <div className="provider-control-title span-full">
                    <strong>Capability and Cost</strong>
                    <span>Updates replace this provider&apos;s editable model capability projection.</span>
                  </div>
                  <label>
                    Model
                    <input name="model_id" defaultValue={firstCapability?.model_id ?? ""} disabled={!live || !firstCapability} />
                  </label>
                  <label>
                    Endpoints
                    <input name="endpoints" defaultValue={(firstCapability?.endpoints ?? []).join(", ")} disabled={!live || !firstCapability} />
                  </label>
                  <label>
                    Input types
                    <input name="input_types" defaultValue={(firstCapability?.input_types ?? []).join(", ")} disabled={!live || !firstCapability} />
                  </label>
                  <label>
                    Output types
                    <input name="output_types" defaultValue={(firstCapability?.output_types ?? []).join(", ")} disabled={!live || !firstCapability} />
                  </label>
                  <label>
                    Tool types
                    <input name="tool_types" defaultValue={(firstCapability?.tool_types ?? []).join(", ")} disabled={!live || !firstCapability} />
                  </label>
                  <label>
                    Cost currency
                    <input name="cost_currency" defaultValue={firstCapability?.cost_currency ?? "USD"} disabled={!live || !firstCapability} />
                  </label>
                  <label>
                    Max cost units
                    <input name="max_cost_units" type="number" min="0" defaultValue={firstCapability?.max_cost_units ?? 0} disabled={!live || !firstCapability} />
                  </label>
                  <label>
                    Estimated cents
                    <input name="estimated_cost_cents" type="number" min="0" defaultValue={firstCapability?.estimated_cost_cents ?? 0} disabled={!live || !firstCapability} />
                  </label>
                  <label>
                    Max batch size
                    <input name="max_batch_size" type="number" min="1" defaultValue={firstCapability?.max_batch_size ?? 1} disabled={!live || !firstCapability} />
                  </label>
                  <label>
                    Aspect ratios
                    <input name="supported_aspect_ratios" defaultValue={(firstCapability?.supported_aspect_ratios ?? []).join(", ")} disabled={!live || !firstCapability} />
                  </label>
                  <label className="span-full">
                    Qualities
                    <input name="supported_qualities" defaultValue={(firstCapability?.supported_qualities ?? []).join(", ")} disabled={!live || !firstCapability} />
                  </label>
                  <label className="checkbox-row">
                    <input name="kill_switch" type="checkbox" defaultChecked={item.routing.kill_switch} disabled={!live} />
                    Kill switch
                  </label>
                  <label className="checkbox-row">
                    <input name="supports_batch" type="checkbox" defaultChecked={firstCapability?.supports_batch ?? false} disabled={!live || !firstCapability} />
                    Supports batch
                  </label>
                  <label className="checkbox-row">
                    <input name="supports_seed" type="checkbox" defaultChecked={firstCapability?.supports_seed ?? false} disabled={!live || !firstCapability} />
                    Supports seed
                  </label>
                  <label className="checkbox-row">
                    <input name="supports_cancel" type="checkbox" defaultChecked={firstCapability?.supports_cancel ?? false} disabled={!live || !firstCapability} />
                    Supports cancel
                  </label>
                  <label className="span-full">
                    Rationale
                    <textarea name="rationale" required={live} minLength={1} placeholder="Operational reason for audit" disabled={!live} />
                  </label>
                  <button className="button" type="submit" disabled={!live}>
                    Save Routing
                  </button>
                </form>
                <form className="provider-control provider-test-call" action={runProviderSandboxTestCallAction}>
                  <input type="hidden" name="provider_id" value={item.provider_id} />
                  <div className="provider-control-title">
                    <strong>Sandbox Test Call</strong>
                    <span className="mono">{item.secret_present ? item.secret_ref : "no secret required"}</span>
                  </div>
                  <label>
                    Model
                    <select name="model_id" defaultValue={firstCapability?.model_id ?? ""} disabled={!live || item.status !== "enabled" || !firstCapability}>
                      {item.capabilities.map((capability) => (
                        <option key={capability.model_id} value={capability.model_id}>
                          {capability.model_id}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Tool
                    <input name="tool_type" defaultValue={defaultTool} disabled={!live || item.status !== "enabled" || !firstCapability} />
                  </label>
                  <label className="span-full">
                    Prompt
                    <textarea name="prompt" defaultValue="Provider sandbox routing smoke" disabled={!live || item.status !== "enabled" || !firstCapability} />
                  </label>
                  <label className="span-full">
                    Test rationale
                    <textarea name="test_rationale" required={live && item.status === "enabled"} minLength={1} placeholder="Why this provider test call is being run" disabled={!live || item.status !== "enabled" || !firstCapability} />
                  </label>
                  <button className="button secondary" type="submit" disabled={!live || item.status !== "enabled" || !firstCapability}>
                    Run Test Call
                  </button>
                </form>
                <form className="provider-control provider-health-probe" action={probeProviderRegistryHealthAction}>
                  <input type="hidden" name="provider_id" value={item.provider_id} />
                  <div className="provider-control-title">
                    <strong>Provider Health Probe</strong>
                    <span>{item.health.available ? "available" : "blocked"} / {item.health.latency_ms} ms / {item.health.error_rate_percent}%</span>
                  </div>
                  <label className="span-full">
                    Probe rationale
                    <textarea name="health_rationale" required={live} minLength={1} placeholder="Why this provider health probe is being refreshed" disabled={!live} />
                  </label>
                  <button className="button secondary" type="submit" disabled={!live}>
                    Probe Health
                  </button>
                </form>
                <form className="provider-control provider-delete" action={deleteProviderRegistryAction}>
                  <input type="hidden" name="provider_id" value={item.provider_id} />
                  <div className="provider-control-title">
                    <strong>Delete Provider Entry</strong>
                    <span className="mono">{item.provider_id}</span>
                  </div>
                  <label className="span-full">
                    Delete rationale
                    <textarea name="delete_rationale" required={live} minLength={1} placeholder="Why this provider registry entry is being removed" disabled={!live} />
                  </label>
                  <button className="button danger-button" type="submit" disabled={!live}>
                    Delete Provider
                  </button>
                </form>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
