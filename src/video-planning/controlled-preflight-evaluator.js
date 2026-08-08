export function createControlledPreflightEvaluator({ evaluate } = {}) {
  return {
    kind: "controlled_test_double",
    async evaluate(input) {
      if (evaluate) return evaluate(input);
      const upstreamValid = input.currentUpstream?.current_valid === true &&
        ["product_revision_id", "copy_version_id", "avatar_selection_id", "avatar_asset_version_id"]
          .every((key) => input.currentUpstream[key] === input.run.input_snapshot.upstream_snapshot[key]);
      const upstream = upstreamValid ? { status: "passed", checks: [{ code: "upstream_current", status: "passed",
        message: "商品、文案和人物引用当前有效" }] } : { status: "blocked", checks: [{ code: "upstream_changed",
        status: "blocked", message: "上游内容已变化，请创建新方案版本" }] };
      const complete = Boolean(input.run.input_snapshot.output_instructions?.trim()) &&
        Boolean(input.run.input_snapshot.capability_config_snapshot?.snapshot_version);
      const completeness = complete ? { status: "passed", checks: [{ code: "plan_complete", status: "passed",
        message: "方案必要信息完整" }] } : { status: "blocked", checks: [{ code: "plan_incomplete", status: "blocked",
        message: "请补充制作说明或能力配置" }] };
      const readiness = input.agentOnline ? { status: "passed", checks: [{ code: "execution_ready", status: "passed",
        message: "执行环境可用" }] } : { status: "warning", checks: [{ code: "local_agent_offline", status: "warning",
        message: "当前没有可用的执行环境，真实生产需等待恢复；不影响方案审核。" }] };
      return { groups: { upstream_validity: upstream, plan_completeness: completeness, production_readiness: readiness } };
    }
  };
}
