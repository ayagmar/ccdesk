/** Claude Code names a project's store after its path with every non-alphanumeric character as "-". */
export function storeDirName(projectPath: string): string {
  return projectPath.replace(/[^a-zA-Z0-9]/g, "-");
}
