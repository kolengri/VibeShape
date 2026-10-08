const transportMetadata =
  /^(?:GITHUB_|RUNNER_|ACTIONS_|CODEX_|AGENT_|TURBO_|AI_AGENT$|PWD$|OLDPWD$|SHLVL$|_$|TERM$|COLORTERM$|FORCE_COLOR$|NO_COLOR$)/

/** Cacheable CI workspaces receive this exact environment; every retained value is hashed. */
export function unitTestEnvironment(environment: NodeJS.ProcessEnv) {
  return Object.fromEntries(
    Object.entries(environment).filter(([name]) => !transportMetadata.test(name)),
  )
}
