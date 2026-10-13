# Changelog

## [0.2.7](https://github.com/ayagmar/ccdesk/compare/v0.2.6...v0.2.7) (2026-10-13)

### Bug Fixes

* **release:** keep docs anchors plain in subjects and breaking notes too ([9cc2436](https://github.com/ayagmar/ccdesk/commit/9cc2436668569b37743aeab17d5f6ac7cb2a8168))
* **release:** link only numbered issues in the changelog ([a43a9c3](https://github.com/ayagmar/ccdesk/commit/a43a9c36100fd6e0e3ce93a3d3d5c04f75d7ae9f))
* **settings:** refuse a number too large for JSON in a number field ([71da4fc](https://github.com/ayagmar/ccdesk/commit/71da4fca973860a9694227493cfb411f9253f4ba))
* **settings:** refuse a number too large for JSON in the JSON field too ([aa931e4](https://github.com/ayagmar/ccdesk/commit/aa931e427880040a37c5a8da7826ca4bd2cec3a8))
* **settings:** say a number is too large instead of calling it invalid JSON ([77a6c29](https://github.com/ayagmar/ccdesk/commit/77a6c29bfab2ac556eeff5a658283eae1645db10))
* **ui:** log why the Markdown renderer did not load ([7e04f22](https://github.com/ayagmar/ccdesk/commit/7e04f22ab941fa4ea9a7da4d5c95d011552dc256))
* **ui:** show text as written when the Markdown chunk fails to load ([60cd738](https://github.com/ayagmar/ccdesk/commit/60cd73854ff9e92cb81629c81089738097b56386))

### Performance Improvements

* **ui:** load the Markdown renderer as its own chunk ([52e0de1](https://github.com/ayagmar/ccdesk/commit/52e0de1074c8c1c10a426e842475f97a50848bc3))

## [0.2.6](https://github.com/ayagmar/ccdesk/compare/v0.2.5...v0.2.6) (2026-10-13)

### Features

* **settings:** edit objects, limited lists and nullable keys with typed fields ([0463dd4](https://github.com/ayagmar/ccdesk/commit/0463dd4692d4589fe31aeba23b4615fb9018f3e0))
* **settings:** warn when an autoMode list drops the built-in rules ([ae80080](https://github.com/ayagmar/ccdesk/commit/ae8008008a6ee4773789820c108c97e072c87344))

### Bug Fixes

* **settings:** describe SchemaStore keys' fields with the docs too ([9ed89a5](https://github.com/ayagmar/ccdesk/commit/9ed89a5c681bdf37d0a8cd2a36f6d591ea882e29))
* **settings:** end a field's first sentence only where a sentence starts ([3288b4a](https://github.com/ayagmar/ccdesk/commit/3288b4a01313a929adda943fd3db930a3af10b9e))
* **settings:** follow the file when a form switched to JSON holds its value ([630020b](https://github.com/ayagmar/ccdesk/commit/630020bb0421de46e3689c8007a94b7453a88628))
* **settings:** keep "e.g." inside a field's first sentence ([72f5e84](https://github.com/ayagmar/ccdesk/commit/72f5e8469a4f38b476998cf964029c5e5c02fa2d))
* **settings:** keep unsaved edits, line breaks and empty lists in typed forms ([0d347d5](https://github.com/ayagmar/ccdesk/commit/0d347d5d0863593e573ac107dbdd58f35a647ae8))
* **settings:** switching the target file keeps a typed value quietly ([2f3fc53](https://github.com/ayagmar/ccdesk/commit/2f3fc539ecf1eadcefa64d1eb01a77deb17582dd))
* **settings:** warn about an empty autoMode list too ([7ff1882](https://github.com/ayagmar/ccdesk/commit/7ff18824fa96bfa7bc2966d63f3cc24b8d52a3c3))
* **settings:** warn about autoMode lists without $defaults in JSON too ([16b75ac](https://github.com/ayagmar/ccdesk/commit/16b75acabd6615417d549158fe88dbdc58baf6f8))

## [0.2.5](https://github.com/ayagmar/ccdesk/compare/v0.2.4...v0.2.5) (2026-10-13)

### Features

* **settings:** edit documented keys the SDK schema lacks, via SchemaStore ([d764c0e](https://github.com/ayagmar/ccdesk/commit/d764c0e0c84a80fe5a9d386ef83b11497e6e809c))

### Bug Fixes

* **settings:** describe borrowed keys with the docs, not SchemaStore ([fbcd686](https://github.com/ayagmar/ccdesk/commit/fbcd68678c24c277fe721332b88303b62d0b2504))
* **settings:** give borrowed keys the docs' full text, not the summary ([5cd93c4](https://github.com/ayagmar/ccdesk/commit/5cd93c44612b0bc082d42fe6dfb0601050470a1a))
* **ui:** stop column heads covering section titles in Firefox ([7ccfce7](https://github.com/ayagmar/ccdesk/commit/7ccfce747c6271c282b3bc71c3b5a76acfa182d7))
* **view:** keep asterisks inside code spans when making docs text plain ([6c3255b](https://github.com/ayagmar/ccdesk/commit/6c3255b540811b062107c93675e8f178deaf8a17))

## [0.2.4](https://github.com/ayagmar/ccdesk/compare/v0.2.3...v0.2.4) (2026-10-13)

### Features

* **core:** warn when a higher managed source than the files is present ([cb04a30](https://github.com/ayagmar/ccdesk/commit/cb04a30e72293270bdf4e3529a938ef13188bb41))

### Bug Fixes

* **core:** count Explorer as having opened the file on Windows ([eb1a120](https://github.com/ayagmar/ccdesk/commit/eb1a12090507be426765c38d2e71a5f5500622ef))
* **core:** hide header values and more secret flags in MCP server args ([3a9ee02](https://github.com/ayagmar/ccdesk/commit/3a9ee024a124602f486b3e8f41e23fffa7c84565))
* **core:** look up ~/.claude.json folders as Claude Code keys them on Windows ([67a445d](https://github.com/ayagmar/ccdesk/commit/67a445d2a569bccd8f1615e798af099ece5dbe38))
* **core:** name long project stores as Claude Code does ([98f4dd8](https://github.com/ayagmar/ccdesk/commit/98f4dd8f4efbe1ce0c2154e58b554c9a05baed95))
* **core:** read JSON files that start with a byte order mark ([6bb2fd3](https://github.com/ayagmar/ccdesk/commit/6bb2fd302d468f1603d2230270ce5c9999027e93))
* **core:** report a backup folder ccdesk cannot read instead of listing none ([1209b9c](https://github.com/ayagmar/ccdesk/commit/1209b9c0a360939a3247fd3e92ad9b0d41b579f6))
* **core:** say why claude did not start on Windows instead of "not on PATH" ([9c0d3ad](https://github.com/ayagmar/ccdesk/commit/9c0d3adcc0ad0cb1ff4ed6b66377b603c1b1f4da))

### Performance Improvements

* **core:** group hand-approved calls without copying each group ([9ab7219](https://github.com/ayagmar/ccdesk/commit/9ab7219986690e08669f3aceacb93f3f48777e11))
* **ui:** refresh the overview on focus and saves, not on watched changes ([9010576](https://github.com/ayagmar/ccdesk/commit/901057643dfcded5f2463ccb09353a5d264f109d))

## [0.2.3](https://github.com/ayagmar/ccdesk/compare/v0.2.2...v0.2.3) (2026-10-13)

### Features

* **cli:** add read-only scan --json and explain subcommands ([fc59aed](https://github.com/ayagmar/ccdesk/commit/fc59aed4935371e2a979991a03a94cf01c0e2e68))
* **core:** add Watcher.subscribe to push changes ([3eb360e](https://github.com/ayagmar/ccdesk/commit/3eb360e286fa34eede2c23aa1b3fe69f2fb6b129))
* **core:** make the core importable as the package entry point ([82a4107](https://github.com/ayagmar/ccdesk/commit/82a41075f88c6b0ab475eb559afe1cf13aacc25a))
* **view:** export the view logic as ccdesk/view ([b0e4365](https://github.com/ayagmar/ccdesk/commit/b0e436513da85184e9e141d2502fba1d297f39ee))

### Bug Fixes

* **core:** refuse to open a file when no editor starts, instead of failing ([a359842](https://github.com/ayagmar/ccdesk/commit/a359842ecd33db582b565878e56a63ac00ad664e))
* **core:** refuse to open credentials or missing paths in createCore ([9562aab](https://github.com/ayagmar/ccdesk/commit/9562aab75961097c97b193f9edac8f5a34f8c701))
* **core:** report broken ~/.claude.json, managed-mcp.json and plugin files ([03710a6](https://github.com/ayagmar/ccdesk/commit/03710a6ff76557bde8e3b935244b700c8b1daf37))
* **core:** report memory, agent and skill files the scan cannot read ([3b91804](https://github.com/ayagmar/ccdesk/commit/3b9180401fd0479aa584c86f56dead7aa12b6dbf))
* **core:** resolve Watcher.subscribe and wait once moved watchers start ([039bb73](https://github.com/ayagmar/ccdesk/commit/039bb73282c014f2389ad37c37b5b80f6a91511e))
* **ui:** disable Undo while it runs and clear stale errors in Recent changes ([2c0c1e5](https://github.com/ayagmar/ccdesk/commit/2c0c1e5e381b49b40c1d99a5b9b3cfd1ce2d25a7))
* **ui:** say how to recover from an expired token wherever a call fails ([f9864a2](https://github.com/ayagmar/ccdesk/commit/f9864a24cf105691e8396de369c4167aa92f9750))
* **ui:** stop warning that the file changed after saving a setting ([e807947](https://github.com/ayagmar/ccdesk/commit/e80794746c9eed8503baa5a6cfa694568ab37740))
* **watch:** rewatch before calling subscribers, so one that throws cannot skip it ([d63fa49](https://github.com/ayagmar/ccdesk/commit/d63fa49cdf947795c8cafabc8e76458f91689601))

### Performance Improvements

* **ui:** load the settings schema and catalog from the server ([34ba654](https://github.com/ayagmar/ccdesk/commit/34ba654ca9d5513a792ed5c44a50490a9d79dd54))

## [0.2.2](https://github.com/ayagmar/ccdesk/compare/v0.2.1...v0.2.2) (2026-10-12)

### Bug Fixes

* **agents:** refuse agent text with values its review would hide ([3a9b39f](https://github.com/ayagmar/ccdesk/commit/3a9b39f2634cf4a10a9fc9a7ba7c627dddebd9da))
* **compare:** ignore key order when comparing settings ([db71cde](https://github.com/ayagmar/ccdesk/commit/db71cde8c19c4bae292e5f41cd8d8c0cf7c578e4))
* **context:** count a linked rule imported by its target's path once ([63830ef](https://github.com/ayagmar/ccdesk/commit/63830ef9096c2a86005cb60bad3d1c872921cdc1))
* **context:** count a rule in a linked folder once when it is also imported ([168039b](https://github.com/ayagmar/ccdesk/commit/168039b738524b1d72f5e48edfcb51bea069a506))
* **context:** prefer the real path the scan recorded when deduplicating ([d5a3e75](https://github.com/ayagmar/ccdesk/commit/d5a3e7566668156de9a3739b9fa51a39301cf697))
* **env:** make a relative CLAUDE_CONFIG_DIR absolute ([2939488](https://github.com/ayagmar/ccdesk/commit/2939488c5ded1869367ca769218f17be8880fcd4))
* **hooks:** refuse a replacement hook with hidden header values ([c40e7b4](https://github.com/ayagmar/ccdesk/commit/c40e7b4dfeda44fe104ad24cbd790a846da31266))
* **mcp:** name the chosen profile in the claude commands ccdesk shows ([4d99fbd](https://github.com/ayagmar/ccdesk/commit/4d99fbd37087fa0a6332bc997975efb510d123b5))
* **mcp:** run claude with the profile chosen by --config-dir ([02c6af0](https://github.com/ayagmar/ccdesk/commit/02c6af0bd56235874dd1a46dd1a3aaf124f299b8))
* **path-test:** apply startup's rules to a subfolder's linked rules ([49d426c](https://github.com/ayagmar/ccdesk/commit/49d426c07beb5ce8e6538c2091b5e3c989d356e1))
* **path-test:** keep AGENTS.md out when a subfolder's CLAUDE.md is skipped ([c05ed89](https://github.com/ayagmar/ccdesk/commit/c05ed89f04db3a83b1dad2e35b803cbb4af2e4a3))
* **path-test:** match a linked rule's target against excludes only as startup does ([dfb6a79](https://github.com/ayagmar/ccdesk/commit/dfb6a79ae70c7eb4c94f4905c76b78f081c8afce))
* **path-test:** skip subfolder instructions and rules over 4 MiB ([3696d74](https://github.com/ayagmar/ccdesk/commit/3696d74ec070dda64184b100b9eecef181e52884))
* **scan:** cite the docs section on MCP rules with parentheses ([901c372](https://github.com/ayagmar/ccdesk/commit/901c3729ed4089bdfd5dd19a6265a5995aae1458))
* **scan:** treat a name starting with two dots as inside its folder ([af6b025](https://github.com/ayagmar/ccdesk/commit/af6b02549e55a24394197da08326412bb1890059))
* **settings:** refuse hook events Claude Code does not know ([b6561e6](https://github.com/ayagmar/ccdesk/commit/b6561e6f9b5a86a9fa27b3138cb570f493edb0d5))
* **usage:** do not start a count for a page that already left ([4984a58](https://github.com/ayagmar/ccdesk/commit/4984a585d6a6ccd3914f2e06b9f274bd4b66eb21))
* **watch:** answer a wait whose watcher closed while it was starting ([5c63129](https://github.com/ayagmar/ccdesk/commit/5c63129bdb60d9bc5f6d13a7665e4f273dcfb406))
* **watch:** answer waiting pages when the watcher closes ([ad1c5ea](https://github.com/ayagmar/ccdesk/commit/ad1c5ea1080362858755e5f2c09e4bf19a3682e2))
* **watch:** refresh when a file inside an installed plugin changes ([a09a99e](https://github.com/ayagmar/ccdesk/commit/a09a99e38c37c765c5117138324d50174ad7b142))
* **watch:** refresh when a missing import is created ([279b033](https://github.com/ayagmar/ccdesk/commit/279b03353f414ed9faeaf0a86450c49da56aea1a))
* **watch:** refresh when a missing import's folder appears later ([91f6444](https://github.com/ayagmar/ccdesk/commit/91f644452c3975dd09b2f1fbb86b2c96cf5da561))
* **watch:** watch ~/.claude/plugins only for the install list ([382b6b0](https://github.com/ayagmar/ccdesk/commit/382b6b0990c82f71dab37cfd8840bd1aec42c47e))
* **watch:** watch only the plugin files the scan reads ([8d12adc](https://github.com/ayagmar/ccdesk/commit/8d12adcfa0cdf74097273516d04130a99cffe578))

## [0.2.1](https://github.com/ayagmar/ccdesk/compare/v0.2.0...v0.2.1) (2026-10-12)

### Features

* **ui:** add a text size control and raise the default sizes ([1a9fe82](https://github.com/ayagmar/ccdesk/commit/1a9fe82b35cc4743936b7bf3c7a6d4244c86779a))
* **ui:** open the docs from the ccdesk logo ([834986a](https://github.com/ayagmar/ccdesk/commit/834986a40df7801e6b4cf12588fd69f65411458a))

### Bug Fixes

* **ui:** keep the section links on one row with the larger text ([f349f19](https://github.com/ayagmar/ccdesk/commit/f349f19c5e81ba3c498ff9f0751f4e3d5d99ade1))

## [0.2.0](https://github.com/ayagmar/ccdesk/compare/v0.1.0...v0.2.0) (2026-10-12)

### Features

* **agents:** create, change and delete subagent files ([1d8d011](https://github.com/ayagmar/ccdesk/commit/1d8d011c93c08dc8435ad304f5061378e8c4c1b7))
* **cli:** add --config-dir to read another Claude folder ([777712a](https://github.com/ayagmar/ccdesk/commit/777712aeb91da62f3f323292c8050b600ff59f5a))
* compare the settings of two directories ([9ec5e56](https://github.com/ayagmar/ccdesk/commit/9ec5e56b0d4f1cfc85b48accaea00ac59cf592c2))
* describe a claude -p or SDK session as well as an interactive one ([45c0ad1](https://github.com/ayagmar/ccdesk/commit/45c0ad180c1a26074d151375f99b80ddb20dd99e))
* **hooks:** add, change and remove hooks in settings files ([7307b6b](https://github.com/ayagmar/ccdesk/commit/7307b6b1f3b7baa1ced8db4be6695e8456c87ef8))
* list claude mcp edits in Recent changes ([bfc153c](https://github.com/ayagmar/ccdesk/commit/bfc153c5f3489143d73c2cfcc75a5fc2c1175e93))
* **mcp:** add, change and remove MCP servers ([40f88a6](https://github.com/ayagmar/ccdesk/commit/40f88a6cce41f4c04d3816dfbd540cb2435482e9))
* **mcp:** check server entries against a schema of the documented fields ([3bfac6c](https://github.com/ayagmar/ccdesk/commit/3bfac6c884c07c03430fd896fe5ec2ba558cbc43))
* **mcp:** say what approved, rejected or holds a .mcp.json server ([1a42288](https://github.com/ayagmar/ccdesk/commit/1a4228880a81a24468caebab84aa27e85fdbde62))
* **site:** add the documentation site with llms.txt ([25148e4](https://github.com/ayagmar/ccdesk/commit/25148e43f4f5190c000f0e3f4aaeb98872c9ef53))
* **site:** capture frames for a video with screenshots --video ([e754f1f](https://github.com/ayagmar/ccdesk/commit/e754f1fd910834044158ca3c2125d706e3ca5d1c))
* **site:** light up each scope's rows in the hero screenshot ([af20413](https://github.com/ayagmar/ccdesk/commit/af204130ea0e1eee8cd428ba7a67df10bb0a6ffa))
* **site:** open each landing page question to the rows that answer it ([29d6815](https://github.com/ayagmar/ccdesk/commit/29d6815b628e68751d9de91d10c07a5805d27bc1))
* **site:** open screenshots in place, add motion and load faster ([340ee81](https://github.com/ayagmar/ccdesk/commit/340ee817449d06910fbc3ae3f6f2003c804014d9))
* **ui:** say that the page describes an interactive session ([c618a77](https://github.com/ayagmar/ccdesk/commit/c618a776a1313d44f8b88c05c9a660e64e55bb38))
* undo a change that created its file by removing the file ([e6297e3](https://github.com/ayagmar/ccdesk/commit/e6297e35296b0c2a9f4fd222bfff71f78216211e))

### Bug Fixes

* **agents:** save a new agent typed as reviewer.md as reviewer.md, not reviewer.md.md ([2d07508](https://github.com/ayagmar/ccdesk/commit/2d07508eeb50dd9fff98e9816e58c1eaa25abc21))
* **backups:** record restored memories and restore halfway deletes ([3bfcbcf](https://github.com/ayagmar/ccdesk/commit/3bfcbcfd487956dd9eddd9f7252c9093887f95d9))
* hide keys in MCP server args ([922475c](https://github.com/ayagmar/ccdesk/commit/922475c067b313f75aee2332f01066bc4739ab55))
* **hooks:** hide the user name, password and query of an http hook's URL ([8b40d25](https://github.com/ayagmar/ccdesk/commit/8b40d25867ca6cbf76164a27584a15309803bb44))
* **instructions:** head your user CLAUDE.md as ~/.claude/CLAUDE.md, not .claude/CLAUDE.md ([683b1c8](https://github.com/ayagmar/ccdesk/commit/683b1c88bd244f1b033b3f546f7944599a0327de))
* **instructions:** say why a linked rule with paths does not load ([922788d](https://github.com/ayagmar/ccdesk/commit/922788d34fdc9333679d8792eb1865aa70acd831))
* match what Claude Code loads and keep hidden values out of edits ([9997c26](https://github.com/ayagmar/ccdesk/commit/9997c2652be271f1c6b3326f84218cfbe27f031d))
* **mcp:** count a "use all servers" answer to the .mcp.json prompt ([3008f9c](https://github.com/ayagmar/ccdesk/commit/3008f9c9792174d2334ce641555167962b7f67e3))
* **mcp:** hide a server's secrets in claude's own error message ([2b7882b](https://github.com/ayagmar/ccdesk/commit/2b7882b5e1df3d3540c06a5c8d7c559ec6ce4328))
* **mcp:** pass names safely to claude mcp and keep servers when it fails ([69b9353](https://github.com/ayagmar/ccdesk/commit/69b9353be3ecd96de2c29ed91183bfce0dfc6274))
* **mcp:** read and add local servers under the repository root only ([c536737](https://github.com/ayagmar/ccdesk/commit/c536737a8e8d05946d43b0bbe74364a890141cd8))
* **memory:** remove a [[name]] index line when its memory is deleted ([a08fbdf](https://github.com/ayagmar/ccdesk/commit/a08fbdf899c17e958c0ac98678d44e4b9b259dd5))
* **memory:** stop flagging a 200-line MEMORY.md that ends in a newline as cut off ([07a670b](https://github.com/ayagmar/ccdesk/commit/07a670b209593d315e7850e6145e8443b5c01554))
* **permissions:** say that ccdesk reads commands and addresses to match rules ([ca60592](https://github.com/ayagmar/ccdesk/commit/ca605920235512d041b03b0fbea57c4967f1ac70))
* **readme:** link each screenshot to its full-size image ([18837fc](https://github.com/ayagmar/ccdesk/commit/18837fc055aede576926f15d90b031c3b6a19fa9))
* **scan:** hold back settings-file hooks until the folder is trusted ([ab9ea97](https://github.com/ayagmar/ccdesk/commit/ab9ea973e153b343530ae5c945b8f71a28dd7895))
* **scan:** name plugin skills and commands with their plugin ([43d178a](https://github.com/ayagmar/ccdesk/commit/43d178a0f14c9479b576c6260eea1541f5fb6d53))
* **server:** put a file back when ccdesk cannot read it while removing it ([bfa4931](https://github.com/ayagmar/ccdesk/commit/bfa49318dc4df99605cc570e004cf6ed0b41543e))
* **server:** refuse a hard link to the credentials file ([8689378](https://github.com/ayagmar/ccdesk/commit/86893788ee20e1c0fc53464306167a5329968d6e))
* **server:** refuse a restore that would change hidden keys in args ([5ab6b40](https://github.com/ayagmar/ccdesk/commit/5ab6b409db633d82ac2cea37833639eff1d88c8d))
* **server:** refuse to save a file that has other hard links ([4fe7445](https://github.com/ayagmar/ccdesk/commit/4fe7445daba710babba8e5bc3826060389857f24))
* **server:** stop on SIGTERM and answer a malformed URL with 400 ([a519fcb](https://github.com/ayagmar/ccdesk/commit/a519fcb7b0f34c21ac35b81b606ec0bc350119d6))
* **server:** watch what a scan read even when the watch starts after it ([554a3d5](https://github.com/ayagmar/ccdesk/commit/554a3d58e9361c209313d258f665b54a09792757))
* **settings:** leave out sandbox fields Claude Code ignores from a file ([97bf3a9](https://github.com/ayagmar/ccdesk/commit/97bf3a95407a21682b0579482bd558071698f40a))
* **settings:** say why a value that may only tighten a key is ignored ([6e01ce8](https://github.com/ayagmar/ccdesk/commit/6e01ce882f08d3a34d1a2725f5371852e6c5b9ce))
* **settings:** show a value set only in the older local file in the details ([57cbc45](https://github.com/ayagmar/ccdesk/commit/57cbc453449eb1b3562062817091f8baa449ccef))
* **site:** draw the GitHub icon in the text colour ([f8dce1c](https://github.com/ayagmar/ccdesk/commit/f8dce1c184b98ed168e3f516f040ce22269a4dd3))
* **site:** line the header search up with the landing page's wider column ([95a1762](https://github.com/ayagmar/ccdesk/commit/95a176252a28e8f98253bd816212af0f8f54111e))
* **site:** name the app section each landing page question is answered in ([977a65c](https://github.com/ayagmar/ccdesk/commit/977a65c41b43fe03320a9181cbb02e1011c3be64))
* **tools:** list a whole-Bash rule under Monitor, whose commands it covers ([52e09b5](https://github.com/ayagmar/ccdesk/commit/52e09b5ead6570c620d0ef9ba9ba5cb8a880ac28))
* **tools:** show a failed count as unknown instead of counting forever ([b7b628d](https://github.com/ayagmar/ccdesk/commit/b7b628d2d6d672a245d9940d51edcfbc42f29f3a))
* **ui:** give the session switch its own line so the directory name keeps its room ([c43db64](https://github.com/ayagmar/ccdesk/commit/c43db642f6d980f8efea19387d09f11d3082272c))
* **ui:** give the tables the room until a row is picked and keep the directory name whole ([8059bea](https://github.com/ayagmar/ccdesk/commit/8059bea410755683637338814413fcc7f1b7844a))
* **ui:** keep an edited draft when the file changes underneath it ([5f72626](https://github.com/ayagmar/ccdesk/commit/5f726268c96160ba703fcec684fd420b0c7a9d3d))
* **ui:** keep the save toast above sticky table headers ([711c670](https://github.com/ayagmar/ccdesk/commit/711c6706fa276511ebe4968f05d105f7244722cf))
* **ui:** line up the columns on Recent changes ([112e732](https://github.com/ayagmar/ccdesk/commit/112e732a3eb776ce121e479538521c2f078551cc))
* **ui:** offer no undo for a change that created its file ([8103ddc](https://github.com/ayagmar/ccdesk/commit/8103ddc8c78ac323039a778be83c3d89f830851a))
* **ui:** offer only settings files that exist here when adding a rule or hook ([34bc591](https://github.com/ayagmar/ccdesk/commit/34bc5914cd23d87da8b2574bf7e4a5402a1571f8))
* **ui:** say that claude mcp edits pass values on claude's command line ([06d971e](https://github.com/ayagmar/ccdesk/commit/06d971e3ff9c7af693bbf9b1d9226b82dcf16100))
* **ui:** ship the small font files instead of inlining them past the CSP ([166ad6a](https://github.com/ayagmar/ccdesk/commit/166ad6a29df96b5df8c6b043e6ed23654226e978))
* **usage:** answer a stopped count even while one of its reads hangs ([9495017](https://github.com/ayagmar/ccdesk/commit/9495017641d050f15ba33d19e13db0b2fc9c0ed9))
* **usage:** stop tool-call counts nobody waits for or that run too long ([cc89847](https://github.com/ayagmar/ccdesk/commit/cc898474b3588c5a64c38fca1635e9bed20f1a27))

### Performance Improvements

* **server:** cap the usage cache and keep only what matching reads ([6e5eeea](https://github.com/ayagmar/ccdesk/commit/6e5eeea66ce209c9598a417540ae0eb3415986b9))
* **server:** reuse a current scan for the path tester ([cb48481](https://github.com/ayagmar/ccdesk/commit/cb484810daa5a5469cef5688d740ba7a418a3756))

### Reverts

* **site:** drop screenshots --video ([0009af4](https://github.com/ayagmar/ccdesk/commit/0009af451f02da3a2d41847e1ce21fbda2d6e892))

## 0.1.0 (2026-10-11)

### Features

* **scan:** read Claude Code config the way Claude Code loads it ([1410e35](https://github.com/ayagmar/ccdesk/commit/1410e35647bd3ce361e81e8e81dfb4fd2a67245a))
* **server:** serve the UI locally with safe, reviewable edits ([c2fe6b6](https://github.com/ayagmar/ccdesk/commit/c2fe6b626d2b7ce42c4076a87307b34f0280f123))
* **shared:** add config types and Claude Code data generated from upstream ([c084af7](https://github.com/ayagmar/ccdesk/commit/c084af74246caf7e2224b7a480453e4baab198a1))
* **ui:** add the timetable UI for browsing and fixing config ([cb25c0f](https://github.com/ayagmar/ccdesk/commit/cb25c0f9edb081f323ca6aa7fc477a7c0db2de69))
* **usage:** count tool calls from transcripts and suggest allow rules ([84687e5](https://github.com/ayagmar/ccdesk/commit/84687e5fabeaea62eaf2b405eee7236f4bd289f5))

### Bug Fixes

* **scan:** show git-ignored files as ignored on Windows ([38982e3](https://github.com/ayagmar/ccdesk/commit/38982e3ab6a9d841ef147c270ee285bc526124a5))
