# Changelog

## [0.5.3](https://github.com/ayagmar/ccdesk/compare/v0.5.2...v0.5.3) (2026-10-19)

## [0.5.2](https://github.com/ayagmar/ccdesk/compare/v0.5.1...v0.5.2) (2026-10-16)

### Features

* **release:** Slack announcements, hourly SDK check, and auto-merged data PRs ([#52](https://github.com/ayagmar/ccdesk/issues/52)) ([cf808dc](https://github.com/ayagmar/ccdesk/commit/cf808dc3a9cd0d960fdc8a57adbef4b1ce41ac49))

## [0.5.1](https://github.com/ayagmar/ccdesk/compare/v0.5.0...v0.5.1) (2026-10-16)

### Features

* **cli:** suggest allow rules from the calls you approved ([fbb94da](https://github.com/ayagmar/ccdesk/commit/fbb94da881c2ddd79f96a815328daa248fe5ef99))

### Bug Fixes

* **core:** suggest no allow rule for answering Claude's questions or plans ([2c97306](https://github.com/ayagmar/ccdesk/commit/2c973063811477d19a65d0e4675aec278ce076e0))
* **release:** make every release after a data update a patch ([f8a5c49](https://github.com/ayagmar/ccdesk/commit/f8a5c493e1700ca852ebba69fb57e8b82bfc38e0))

## [0.5.0](https://github.com/ayagmar/ccdesk/compare/v0.4.4...v0.5.0) (2026-10-16)

### Features

* **cli:** compare two directories and forget gone ones from the terminal ([b9f5202](https://github.com/ayagmar/ccdesk/commit/b9f5202a30763fd8bc7c3d6861af1889738cd25b))

## [0.4.4](https://github.com/ayagmar/ccdesk/compare/v0.4.3...v0.4.4) (2026-10-16)

### Bug Fixes

* **release:** make a patch when no commit calls for a bump ([e417b1c](https://github.com/ayagmar/ccdesk/commit/e417b1c701704e595d442fc6ee09f4fd5b9523b9)), references [#51](https://github.com/ayagmar/ccdesk/issues/51)

## [0.4.3](https://github.com/ayagmar/ccdesk/compare/v0.4.2...v0.4.3) (2026-10-15)

### Features

* **release:** release after a data update, and announce each release ([8f76af0](https://github.com/ayagmar/ccdesk/commit/8f76af0c009606620d3585818de551d5d58863a9))

### Bug Fixes

* **build:** mark the built CLI executable ([f5afa7b](https://github.com/ayagmar/ccdesk/commit/f5afa7b8b682b2e9d887fde8f323d6a605f0f87e))

## [0.4.2](https://github.com/ayagmar/ccdesk/compare/v0.4.1...v0.4.2) (2026-10-14)

### Features

* **ui:** a way back from What Claude sees ([4b6995c](https://github.com/ayagmar/ccdesk/commit/4b6995c84de34b2675521fdd3537d4d1dc91db3c))
* **ui:** hide the rail, and fold the main directory list ([7010cf4](https://github.com/ayagmar/ccdesk/commit/7010cf43a0ee53feba42dd628547a3424aa60335))

### Bug Fixes

* **ui:** keep keyboard focus when leaving What Claude sees ([02bd51d](https://github.com/ayagmar/ccdesk/commit/02bd51d61fda13f881ad4d4ffac02db394ca9e81))
* **ui:** keep the hidden rail to wide windows, and the phone bar on one row ([f5f9fa2](https://github.com/ayagmar/ccdesk/commit/f5f9fa27597d0b41e2083be8545892b2fb71ecb2))

## [0.4.1](https://github.com/ayagmar/ccdesk/compare/v0.4.0...v0.4.1) (2026-10-14)

## [0.4.0](https://github.com/ayagmar/ccdesk/compare/v0.3.0...v0.4.0) (2026-10-14)

### Features

* **core:** forget a directory whose folder is gone ([ce3a58f](https://github.com/ayagmar/ccdesk/commit/ce3a58fa169db17025f9925c1e332044a5698284))
* **core:** watch ~/.claude.json and wake the page when what it shows changes ([f96ccd4](https://github.com/ayagmar/ccdesk/commit/f96ccd42bbcadd5743c92f3e5f1ab87afd951127))
* push config changes to the page over server-sent events ([8a4d198](https://github.com/ayagmar/ccdesk/commit/8a4d198234c51e711642818d548a6e527d5c3d84))
* **ui:** fold deleted folders away in the rail and the overview ([6d64e23](https://github.com/ayagmar/ccdesk/commit/6d64e23a8c13175fb661ecb9f3d5ff5e9ec14746))
* **ui:** forget a directory whose folder is gone ([ae90e30](https://github.com/ayagmar/ccdesk/commit/ae90e30964a1e74b9c683fc4e03141e7fbe428cd))
* **view:** filter settings by the file that decides each value ([b6808d2](https://github.com/ayagmar/ccdesk/commit/b6808d2df107d1368ecbfc0620d2fe7f911391a1))
* **view:** mark a setting whose value is Claude Code's default ([b577227](https://github.com/ayagmar/ccdesk/commit/b577227872e79833dab503bd52641b1e03c444c6))

### Bug Fixes

* **core:** follow a linked ~/.claude.json to the file it leads to ([b09b985](https://github.com/ayagmar/ccdesk/commit/b09b9853fc299de8f1603ae100786023052fa4a4))
* **core:** keep a shared store a live repository's auto memory uses ([74dbfcc](https://github.com/ayagmar/ccdesk/commit/74dbfcc3b0093e0063a72a5a419f700acbb2d86e))
* **core:** never forget a store a live directory shares, or a folder ccdesk cannot reach ([5bc8609](https://github.com/ayagmar/ccdesk/commit/5bc860914fbc4c9306f8c252e9cd522ffa76745a))
* **core:** read ~/.claude.json once its events settle ([a2db8f7](https://github.com/ayagmar/ccdesk/commit/a2db8f7d037d37415d522efcb83ce5006ce49e4e))
* **core:** read the ~/.claude.json baseline again when its project entries change ([6c16599](https://github.com/ayagmar/ccdesk/commit/6c16599990e318e5060cca4690c1b5a0ea893be3))
* **core:** stop listing a gone directory known only from ~/.claude.json ([736afd2](https://github.com/ayagmar/ccdesk/commit/736afd25e3f25694cb23fc0d4eaa595dc0193799))
* **core:** wait for every queued ~/.claude.json read before reusing a scan ([032a856](https://github.com/ayagmar/ccdesk/commit/032a8562074cd35ecb974e7d3f02fd11069bba93))
* **core:** word the refused store restore without guessing why ([a39eb5f](https://github.com/ayagmar/ccdesk/commit/a39eb5f53d01bcc0592b6f9052d4deb4ba5a462d))
* **ui:** disable the forget button while the review is read again ([07e7918](https://github.com/ayagmar/ccdesk/commit/07e7918967a43d90e8130930a688b0dd4931d839))
* **ui:** keep the open deleted folder in its rail group ([ff4b963](https://github.com/ayagmar/ccdesk/commit/ff4b963de984fea2e26bab029df8ef2669677b28))
* **ui:** let a rail group fold while it holds the open directory ([dd9c14a](https://github.com/ayagmar/ccdesk/commit/dd9c14abf38bd490c6ab3da49e3c4061b6f52749))
* **ui:** reload the directory once each event stream opens ([5c37c66](https://github.com/ayagmar/ccdesk/commit/5c37c66f6f5c0cc9cda089e3094c6e4e87194714))
* **ui:** shorten the badge on an extension Claude is not offered ([d018699](https://github.com/ayagmar/ccdesk/commit/d0186997b6c5a95a11e65e10e2f3a092616dec11))
* **ui:** warn about a running session and keep the forget button after a refusal ([5daff37](https://github.com/ayagmar/ccdesk/commit/5daff37bb2d53f036bd6f5ad30d49285e79f370d))
* **view:** do not mark a default that overrides a different value ([098e484](https://github.com/ayagmar/ccdesk/commit/098e4848dae172d086304a95a1a0ac21eff7bb20))
* **view:** give settings held for trust their own filter value ([a276233](https://github.com/ayagmar/ccdesk/commit/a2762338991cadb1ce6c6f9a641162d4defd455e))

### Reverts

* Revert "chore: update Claude Code data (claude-agent-sdk 0.3.299)" ([cd63df8](https://github.com/ayagmar/ccdesk/commit/cd63df87ffc23083897991552d4c6a209c62e17e))

## [0.3.0](https://github.com/ayagmar/ccdesk/compare/v0.2.7...v0.3.0) (2026-10-14)

### Features

* **cli:** ccdesk check fails when a session reads a broken file of its repository ([a8e360c](https://github.com/ayagmar/ccdesk/commit/a8e360cf77a9b53d6dd4191e6f73bb7b20167645))
* **ui:** say when the page cannot follow every config file ([85db924](https://github.com/ayagmar/ccdesk/commit/85db924f6f1cbcb9b5d6542b15acc41707bb29bf))
* **ui:** show how often Claude read each memory ([6d8e5b4](https://github.com/ayagmar/ccdesk/commit/6d8e5b47fa84da7046ec1ace1fb1e76d2d16a44f))

### Bug Fixes

* **cli:** name the runner's files in ccdesk check's not-counted line ([95bd350](https://github.com/ayagmar/ccdesk/commit/95bd350ca7cb74a83b7da5a8683b341d6dc87649))
* **core:** apply each trust gate the way Claude Code does ([523bf20](https://github.com/ayagmar/ccdesk/commit/523bf200c370beee466daced48c9b865afb8a4f1))
* **core:** back off when the same folder keeps failing to be watched ([6fca2b3](https://github.com/ayagmar/ccdesk/commit/6fca2b39521174f97cf295ab500d5037b371b676))
* **core:** check a local settings file against the checkout that holds it ([e6b1ba6](https://github.com/ayagmar/ccdesk/commit/e6b1ba6384d7db96432759e108000c41c638eb15))
* **core:** check CLAUDE_CODE_PROJECT_DIR_NAME and count its store's sessions ([24e2eb5](https://github.com/ayagmar/ccdesk/commit/24e2eb5b5db0ab44b93b9b78bb65e6b30ee9df5c))
* **core:** check macOS repeats only briefly, and by inode and change time ([7524612](https://github.com/ayagmar/ccdesk/commit/7524612828eecfe5ee663f0d37a986f5cd55bb2b))
* **core:** close the gaps the review found in home links and moved files ([ec2ee82](https://github.com/ayagmar/ccdesk/commit/ec2ee828d8539187d78a073f91b9d8891aae378d))
* **core:** compare hidden setting values as the files have them ([dd5875c](https://github.com/ayagmar/ccdesk/commit/dd5875c0c0ea7ed8ef446443fac3255fcba3781d))
* **core:** compare reserved skill names as Claude Code does ([985c4dd](https://github.com/ayagmar/ccdesk/commit/985c4ddfe72bd4766a81def446798c1f1f8884ea))
* **core:** count a renamed skill's folder name as taken from synced skills ([4e5f48d](https://github.com/ayagmar/ccdesk/commit/4e5f48d7c19501b16fb89932b0e6fd75076f66be))
* **core:** count a watcher event that names no file ([8b9f6ac](https://github.com/ayagmar/ccdesk/commit/8b9f6ac15b0c247d44f078dee53b2def0572772e))
* **core:** count calls an MCP allow rule's tool-name glob covers ([7424684](https://github.com/ayagmar/ccdesk/commit/7424684551a8f0eb3bb5665a24d5ddd1cd46a934))
* **core:** do not follow a rules folder that links to a network location ([8a02691](https://github.com/ayagmar/ccdesk/commit/8a0269153f2267a8bf54046d1dffd1500b13be85))
* **core:** drop a managed value of the wrong shape and keep its secrets hidden ([1b02602](https://github.com/ayagmar/ccdesk/commit/1b026021d5b508193b48be7f9c1f55182b81dc25)), references [#11](https://github.com/ayagmar/ccdesk/issues/11)
* **core:** exempt a local file from trust only in the configuration home a session starts in ([b0176f2](https://github.com/ayagmar/ccdesk/commit/b0176f2072b16ff8c924c464ac184d52288d9a8c)), references [#11](https://github.com/ayagmar/ccdesk/issues/11)
* **core:** expand variable references before matching MCP policy ([59730a2](https://github.com/ayagmar/ccdesk/commit/59730a228a546f214cbdb981e47afd50154dd241))
* **core:** explain an ignored MCP allow entry and read exporter off values exactly ([f744ebc](https://github.com/ayagmar/ccdesk/commit/f744ebce1e2a7a9855cc09c57e7f424a3d0d8857)), references [#11](https://github.com/ayagmar/ccdesk/issues/11)
* **core:** fail a macOS watch start that cannot be shown to be live ([60857d1](https://github.com/ayagmar/ccdesk/commit/60857d14b16c53f8b53d6f6c73bab8cca8169f21)), references [#15](https://github.com/ayagmar/ccdesk/issues/15)
* **core:** find [@imports](https://github.com/imports) the way Claude Code does ([eb8c054](https://github.com/ayagmar/ccdesk/commit/eb8c0548be9fde44c22163b0468c3b05c578eed9))
* **core:** find a submodule's or bare repository's auto memory store ([17e4e81](https://github.com/ayagmar/ccdesk/commit/17e4e81b10432d33b52eb79054b5ad99612c6888))
* **core:** find commands where Claude Code does and pick one per name ([cca6569](https://github.com/ayagmar/ccdesk/commit/cca6569b02e72ec5d7b5e7508d7cb0dcb1151ebd))
* **core:** hedge nested settings errors and target the review-fix notes ([a46750b](https://github.com/ayagmar/ccdesk/commit/a46750bbe425fec76165adfb385a2b99c00b611e)), references [#11](https://github.com/ayagmar/ccdesk/issues/11)
* **core:** hide env values in a plugin command's inline content ([9581182](https://github.com/ayagmar/ccdesk/commit/95811828f49511e975e58395415c4dc68c186c83))
* **core:** hide secrets in MCP policy entries, and match them unhidden ([f9e2947](https://github.com/ayagmar/ccdesk/commit/f9e2947e0e956c80a37bfcb6351a2b147ea812af))
* **core:** hold a repository's env and MCP approvals under Claude Code's trust rules ([aa7011d](https://github.com/ayagmar/ccdesk/commit/aa7011d19b4fcb00056ef15e4df09b9d8b5dbb6f))
* **core:** honour turning off the built-in AGENTS.md plugin ([89b29e3](https://github.com/ayagmar/ccdesk/commit/89b29e3e4e13e2713c07eeb70f2b1e64b00e17c2))
* **core:** keep a plain watch beside a recursive one on the same folder ([a374a54](https://github.com/ayagmar/ccdesk/commit/a374a545634ec0630d8c7ce6c0610be550e3b053))
* **core:** keep MEMORY.md lines that still point at a memory ([1d8c4ae](https://github.com/ayagmar/ccdesk/commit/1d8c4ae72f3f6183ea1acbdd1d5e492503a3d083))
* **core:** keep MEMORY.md lines with links ccdesk cannot read ([f64283f](https://github.com/ayagmar/ccdesk/commit/f64283feb11e356e108c9c54205cc08039e02791))
* **core:** keep the macOS repeat rules out of the ~/.claude.json check ([9f180ef](https://github.com/ayagmar/ccdesk/commit/9f180eff713c3b11977f5c0fd6885c217554a5d1))
* **core:** keep your answer when a copied call is read before the original ([7d02e28](https://github.com/ayagmar/ccdesk/commit/7d02e28a3a7833ac3a2ea64a0310e6fe9f8f4af6))
* **core:** leave out env variables Claude Code ignores from a file ([a26e5be](https://github.com/ayagmar/ccdesk/commit/a26e5be572005b53a9b4bc18f05e37e400d0968c))
* **core:** leave skills with paths out of the listing at session start ([695ac9f](https://github.com/ayagmar/ccdesk/commit/695ac9f7e770869dea3764325b540cde4cf75999))
* **core:** let a plugin's commands map replace its commands folder ([3b0f360](https://github.com/ayagmar/ccdesk/commit/3b0f360e5c0a42b6a1a88db39f3e92c56dfc6a40))
* **core:** let a rule's usable paths match when another pattern cannot compile ([fab36c1](https://github.com/ayagmar/ccdesk/commit/fab36c15655c97d86c599d0928c91470e5dd45ac)), references [#14](https://github.com/ayagmar/ccdesk/issues/14)
* **core:** list a repository's memory store when Claude Code only ran in a subfolder ([8fbd4bd](https://github.com/ayagmar/ccdesk/commit/8fbd4bdf2c756a8b97a8c8c1ff3648ddca4faceb))
* **core:** list a subfolder's skills whatever their paths say ([8307a9c](https://github.com/ayagmar/ccdesk/commit/8307a9c08181e663c3c3531a081ca7984c91bc81))
* **core:** list an Edit allow path under the reading tools too ([50e0c01](https://github.com/ayagmar/ccdesk/commit/50e0c01e53732e2448c274fbf2a81678558d0b0f))
* **core:** list skills-dir plugins and read the plugins root Claude Code uses ([de8294a](https://github.com/ayagmar/ccdesk/commit/de8294a88590bbdc0430fa0a930a0100520b38f0))
* **core:** load a file reached under two names once ([cfad87c](https://github.com/ayagmar/ccdesk/commit/cfad87c45574937b4e5a065628df40b6fc9a331a))
* **core:** load no hooks from a plugin hooks file without its hooks object ([d871857](https://github.com/ayagmar/ccdesk/commit/d8718571d7fd48eb35373755c5fe5ccd13f16431))
* **core:** make a new watch live before Watcher.subscribe and wait resolve ([baf3ab8](https://github.com/ayagmar/ccdesk/commit/baf3ab81375e5b4fa06d24e5ee65886b272a2393))
* **core:** mark an allow rule Claude Code skips for its tool-name glob ([f4d8d16](https://github.com/ayagmar/ccdesk/commit/f4d8d16727428eb6bef1a9e0afff49e20e13531f))
* **core:** match claudeMdExcludes through .claude folders and linked prefixes ([9bd8363](https://github.com/ayagmar/ccdesk/commit/9bd83637cc15cecf8d7bbb11445483ac6b1f7a4a))
* **core:** match rule and skill paths the way Claude Code does ([e4b55db](https://github.com/ayagmar/ccdesk/commit/e4b55db1e7e1d4b9a63c61b2f39e2ae2367cab4d))
* **core:** name plugin MCP servers as Claude Code registers them ([2a52c08](https://github.com/ayagmar/ccdesk/commit/2a52c08bbc3cacd3b33aa1026ff675a2ed724e48))
* **core:** name the folders ccdesk cannot watch and try them again ([61afeb3](https://github.com/ayagmar/ccdesk/commit/61afeb31c67ee7c7ef085029785a37df1d5118ab))
* **core:** never take a folder or a whole-second time for a macOS repeat ([81869af](https://github.com/ayagmar/ccdesk/commit/81869af633f27303c12e86baedc96802778f2e2c))
* **core:** read frontmatter that only parses once quoted, as Claude Code does ([e729b59](https://github.com/ayagmar/ccdesk/commit/e729b591f0c5f3a580b1297299ce36e02ab1cc1e))
* **core:** read invalid managed settings as Claude Code repairs them ([6db30fc](https://github.com/ayagmar/ccdesk/commit/6db30fcb68dae66c537ee94e5a06b47507d3a46c))
* **core:** read the main checkout's skills, agents and commands in a worktree ([bf15220](https://github.com/ayagmar/ccdesk/commit/bf15220ecde7f29ebe94de7e860d56f8729d69c4))
* **core:** refuse a new project agent for a folder that no longer exists ([0cec4db](https://github.com/ayagmar/ccdesk/commit/0cec4dbe1bf3d31e6aa2dd7448fb6e016ff450d1))
* **core:** refuse a save when the reviewed file moved since the review ([124ae9b](https://github.com/ayagmar/ccdesk/commit/124ae9bb05b1143290d38154814f4c45d5257731))
* **core:** resolve each model's effort level and cap field by field ([07c3f86](https://github.com/ayagmar/ccdesk/commit/07c3f86158ffae2b22f0db423e0ce3e4c11e56cb))
* **core:** say claudeMdExcludes globs with a drive letter are not followed through links ([1c08eaa](https://github.com/ayagmar/ccdesk/commit/1c08eaae2f1ff488f1ca7beea468b3e559f32d60))
* **core:** show the managed folder's .claude/rules ([0450204](https://github.com/ayagmar/ccdesk/commit/045020401aabd846afd75a205fd214d36487b7be))
* **core:** skip a managed CLAUDE.md or rule over 4 MiB ([11dbe30](https://github.com/ayagmar/ccdesk/commit/11dbe3043ccb39e874ceeb90be214c8cd39187bc))
* **core:** skip a settings file the schema rejects, as Claude Code does ([44a1587](https://github.com/ayagmar/ccdesk/commit/44a158732d6f2b20e116a471ade91701a59d4b69))
* **core:** skip a turned-off skills-dir plugin's own SKILL.md ([391af46](https://github.com/ayagmar/ccdesk/commit/391af46dd73e619a43a1d96e0131d2f742033d81))
* **core:** skip a whole settings file only when its top-level shape fails ([a4d04ea](https://github.com/ayagmar/ccdesk/commit/a4d04ea95c93eaf237b7a85a28d46fa3ced20e88)), references [#11](https://github.com/ayagmar/ccdesk/issues/11)
* **core:** skip instruction files at the filesystem root ([97ceeec](https://github.com/ayagmar/ccdesk/commit/97ceeeced4eb1a56621dc88c86dd255c1378ecdd))
* **core:** skip skills and commands with names Claude Code reserves ([3441599](https://github.com/ayagmar/ccdesk/commit/34415997d7d049404538a35f99947a25a38ac0d6))
* **core:** skip the main checkout's project instructions in a worktree inside it ([45ebef3](https://github.com/ayagmar/ccdesk/commit/45ebef383099fa33a4c89d9796761c17ff0bb40a))
* **core:** split paths at commas outside braces only ([61abf85](https://github.com/ayagmar/ccdesk/commit/61abf8547f6ab564efcc13e0a39a7f969b7c5810))
* **core:** still warn about a registry policy that reg.exe prints at length ([fc31923](https://github.com/ayagmar/ccdesk/commit/fc31923c33cf27655a66866aed3eb3e571ce9664)), references [#14](https://github.com/ayagmar/ccdesk/issues/14)
* **core:** stop reusing a scan while a folder it read is not watched ([175ab63](https://github.com/ayagmar/ccdesk/commit/175ab63b6c295426096f1ed957988acb007c6e36))
* **core:** stop synced skills from shadowing your skills and commands ([927b2df](https://github.com/ayagmar/ccdesk/commit/927b2df9b492552ecd06e898bde5602ac4dc1c3d))
* **core:** tell subscribers once about a change macOS reports again ([e427534](https://github.com/ayagmar/ccdesk/commit/e4275349af249d13a191f4ae49413a25679f98bb))
* **core:** treat a link to the home folder as home when picking settings files ([a68d7b6](https://github.com/ayagmar/ccdesk/commit/a68d7b6c6f4c83298f7207b7bced685e755f074c))
* **core:** treat a rule whose paths is ** as loaded every session ([3a7af8a](https://github.com/ayagmar/ccdesk/commit/3a7af8a25a7ddfe05a4fc44e4554d647d9557b6f))
* **core:** treat a skill whose paths is ** as listed at session start ([21dbb51](https://github.com/ayagmar/ccdesk/commit/21dbb519936a710e17d6f84029c8f50b5fe9267c)), references [#12](https://github.com/ayagmar/ccdesk/issues/12)
* **core:** turn the built-in AGENTS.md plugin off for any value but true ([751230e](https://github.com/ayagmar/ccdesk/commit/751230eb2ff02bae878e6ae5d6c3344d7c8e0f4e)), references [#12](https://github.com/ayagmar/ccdesk/issues/12)
* **core:** warn about managed policy in the Windows registry ([1887d0f](https://github.com/ayagmar/ccdesk/commit/1887d0fa4aa1bbad0d037a374a26594c9830d627))
* **core:** warn when a restore would create a deleted folder again ([92bdeca](https://github.com/ayagmar/ccdesk/commit/92bdeca61e61a52e4859ecf44027cd105157544b))
* **core:** watch each folder once, and stop retrying network drives ([d20cda4](https://github.com/ayagmar/ccdesk/commit/d20cda452318807cab68a1213f9ae238bb36df1b))
* **core:** watch the managed agents, skills, commands and output styles ([98917a8](https://github.com/ayagmar/ccdesk/commit/98917a882efe9e0642d6d0033ac7fbf10945588e))
* **core:** watch the marketplace files that decide whether a plugin is on ([1e90923](https://github.com/ayagmar/ccdesk/commit/1e909233b719c826f465264bff9b83f2fee5d9bb))
* **core:** withhold what a managed plugin-only policy keeps from loading ([b1aeba3](https://github.com/ayagmar/ccdesk/commit/b1aeba3e72953928304f640e8057214cf9bfde69))
* **settings:** treat a ~/.claude that links to the Claude folder as the user's ([b7f2ccd](https://github.com/ayagmar/ccdesk/commit/b7f2ccd0ba7acac63b2ee6cb161835d8c409c835)), references [#10](https://github.com/ayagmar/ccdesk/issues/10)
* **site:** keep a wrapped question's chevron on its first line ([f95d4ad](https://github.com/ayagmar/ccdesk/commit/f95d4ad787504c0b9fb127ccc5709073e7dc4ef3))
* **site:** keep the space before a link or code that starts a line ([5a720a0](https://github.com/ayagmar/ccdesk/commit/5a720a0cfe56ca48eab9ce63ed0640fc79edab0d))
* **ui:** draw a failure to build the rows inside the page ([5119c44](https://github.com/ayagmar/ccdesk/commit/5119c44b3a125d1e0e8a8640e4a4d02df7c74ddb))
* **ui:** draw the column-head rule under every column ([a02303e](https://github.com/ayagmar/ccdesk/commit/a02303e5dcf6ddcce49327966905bfbcb5242552))
* **ui:** draw the sort marks from the icon set ([a2c9c61](https://github.com/ayagmar/ccdesk/commit/a2c9c61ff962d31a9b19fb3764957b2b28b3df70))
* **ui:** drop short shared files under their label instead of wrapping them ([f37b2e5](https://github.com/ayagmar/ccdesk/commit/f37b2e539faea48af5282441ec2485837ae7121a))
* **ui:** fit a nested directory's header and shared files in narrow columns ([958e36a](https://github.com/ayagmar/ccdesk/commit/958e36a25ed1fa75239af835860c9b8fee84a89b))
* **ui:** fit the built-in tools table beside the inspector ([166bbc9](https://github.com/ayagmar/ccdesk/commit/166bbc9fb2a07d787f4a43973b9a94f777bdbbf6))
* **ui:** flag a scope with an unreadable settings file on the route strip ([da9d317](https://github.com/ayagmar/ccdesk/commit/da9d317ae5fa3492dbe80e53850a282b12b37b5a))
* **ui:** fold the rail into one bar on phones ([ffa2153](https://github.com/ayagmar/ccdesk/commit/ffa2153bdc773fb11c505fb3131dadf4d5742ff3))
* **ui:** give every palette result the same shape ([4dc31ac](https://github.com/ayagmar/ccdesk/commit/4dc31ac0bc2da4ab06539da571e05897953d5f4c))
* **ui:** give table descriptions room and keep the end of long paths ([b4073a3](https://github.com/ayagmar/ccdesk/commit/b4073a3cc3a2fa94c83cc8c7f98c628869e20ad3))
* **ui:** ignore a trailing slash on a folder typed to compare with ([ff52b35](https://github.com/ayagmar/ccdesk/commit/ff52b35a3c65f009f9b3d258496df3cdf9c57250))
* **ui:** invert the current rail item as DESIGN.md says ([42bbf2b](https://github.com/ayagmar/ccdesk/commit/42bbf2b40d12d54866b175d5d67491d03cf624ba))
* **ui:** keep route strip stops apart and their facts short ([6299edf](https://github.com/ayagmar/ccdesk/commit/6299edfce054c50eee3ca85dc37de173ab3c3b58))
* **ui:** keep the directory path readable in the page header ([2e95313](https://github.com/ayagmar/ccdesk/commit/2e95313917eba5aed1ed0ead70fa32f8e4e48ab0))
* **ui:** lead a folder that no longer exists with that fact, and keep edits to user files ([738a517](https://github.com/ayagmar/ccdesk/commit/738a517aa1f24b59b9699c65292bb522fd9eeb20))
* **ui:** leave a file's frontmatter out of its Read view, keep it in Raw ([81ed02c](https://github.com/ayagmar/ccdesk/commit/81ed02ca29ac58bbcedd170ea5a8a96e4af87b7c))
* **ui:** list where a setting is read from as letters, not hollow bullets ([c9aa779](https://github.com/ayagmar/ccdesk/commit/c9aa779dcab61529524bf14cefa13e05b23d1c28))
* **ui:** make the text size control read as a size ramp ([c8ded79](https://github.com/ayagmar/ccdesk/commit/c8ded7933d1eecdef40464378fedadbf6e22b309))
* **ui:** name a held env value before an ignored one ([5a64b26](https://github.com/ayagmar/ccdesk/commit/5a64b2685d0169d9c10d6da1cae18acd492983e6))
* **ui:** name and show things the same way in the table and the inspector ([8125cf9](https://github.com/ayagmar/ccdesk/commit/8125cf9d1fd4e4bb35120eb444bab0f036eab1c4))
* **ui:** name tables, the selected row and bullets for screen readers ([87570f8](https://github.com/ayagmar/ccdesk/commit/87570f80166b1f4e4f6d91bb82a46a5743aa866d))
* **ui:** name the compare page's hidden-value check and keep long keys readable ([0610962](https://github.com/ayagmar/ccdesk/commit/061096218710294a76686837c6398c56c5e66f3b))
* **ui:** name the directory a memory is saved for, not its store folder ([bb3fb5e](https://github.com/ayagmar/ccdesk/commit/bb3fb5edbeae79da019a9173d367f05f5b9d7814))
* **ui:** one style for destructive buttons, wrapped diffs, a toast that waits ([9e55db2](https://github.com/ayagmar/ccdesk/commit/9e55db28f4c3942a1c75e92fa6f15592cdb14add))
* **ui:** raise field borders and selected-row text to WCAG contrast ([5115f22](https://github.com/ayagmar/ccdesk/commit/5115f227441fe7e6b4fdd3b2788b84ca3eb40580)), references [#8f8c81](https://github.com/ayagmar/ccdesk/issues/8f8c81) [#6e6c64](https://github.com/ayagmar/ccdesk/issues/6e6c64) [#5a5852](https://github.com/ayagmar/ccdesk/issues/5a5852)
* **ui:** read a scope name once, keep header flags whole, stop the 768px scroll ([b279c60](https://github.com/ayagmar/ccdesk/commit/b279c609ed2321115d4c2d3b1b6461bce0335938)), references [#18](https://github.com/ayagmar/ccdesk/issues/18)
* **ui:** return focus to the selected row when the inspector closes ([9f1fd44](https://github.com/ayagmar/ccdesk/commit/9f1fd44ebf5b1f1a6a2de733dd02b5b909326e62))
* **ui:** set only file names in mono in What Claude sees ([8c4e309](https://github.com/ayagmar/ccdesk/commit/8c4e3091e73313497465cf582ff714f6df0bb908))
* **ui:** show a drawing error on the page instead of a blank app ([fb3b6a3](https://github.com/ayagmar/ccdesk/commit/fb3b6a3d1460667494b97567797feef87c2500e7))
* **ui:** show the whole focus ring on segmented options ([fc0051f](https://github.com/ayagmar/ccdesk/commit/fc0051f9e81976d27ca80508dfec212dd975091c))
* **ui:** stop the drawer heading looking like a field, and add a scrim ([a80ac24](https://github.com/ayagmar/ccdesk/commit/a80ac24341e368ad40dcfff56569391b01d2918a))
* **ui:** turn failed page loads into a notice with Try again ([e7adfa7](https://github.com/ayagmar/ccdesk/commit/e7adfa7f41c263f0c01fb91d6192c0ab107c689e))
* **ui:** what Claude sees names only real sources and labels its columns ([7ffe42f](https://github.com/ayagmar/ccdesk/commit/7ffe42fd0a275ca355e645b730087abb76006b09))

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
