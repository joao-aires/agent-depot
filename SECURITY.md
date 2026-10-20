# Security

Agent Depot reads repository declarations and upstream content as input. Acquisition never activates hooks, launches MCP servers or runs acquired scripts. Nevertheless, consuming acquired material later can execute code or influence agents; review the content and its declared capabilities before activation in another tool.

Report vulnerabilities privately through [GitHub private vulnerability reporting](https://github.com/joao-aires/agent-depot/security/advisories/new) when available. Do not include credentials or private upstream material in public issues. If private reporting is unavailable, contact the repository owner through an established private channel rather than publishing exploit details.

Preserve `.agent-depot/transaction/` after an interrupted write until recovery completes. Recovery protects recorded generations and refuses unexpected subsequent edits; it does not replace backups against disk loss or malicious modification of the repository's own control files.
