window.__ModuleLoader__.load({
	id: "dsh-folder-attach",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");

		//#region dictionaries
		const NS = "folder-attach";
		const dictionaries = {
			zh: {
				"button.title": "添加文件夹",
				"button.hint": "在主机上选择文件夹，插入 @路径 引用（浏览器可用）",
				"button.picking": "等待主机选择…",
				"command.label": "添加文件夹",
				"command.description": "选择主机上的文件夹，作为 @路径 引用插入输入框",
				"picked.none": "未选中文件夹",
				"failed": "无法获取文件夹路径：{message}",
				"inserted": "已插入 {count} 个文件夹引用",
				"dropped.missed": "{count} 个文件夹无法在当前工作区内定位，请改用「添加文件夹」。",
				"dropped.partial": "已插入 {resolved} 个；{missed} 个未在工作区内找到。",
				"noWorkspace": "当前会话没有工作目录，无法解析文件夹。",
				"image.tooMany": "一次最多 {count} 张图片。",
				"image.fileTooLarge": "有图片超过单张上限 {size}。",
				"image.totalTooLarge": "这批图片总量超过 {size}。"
			},
			en: {
				"button.title": "Add folder",
				"button.hint": "Pick a folder on the host and insert an @path reference (works in the browser)",
				"button.picking": "Waiting for host…",
				"command.label": "Add folder",
				"command.description": "Choose a folder on the host and insert it as an @path reference",
				"picked.none": "No folder selected",
				"failed": "Could not obtain the folder path: {message}",
				"inserted": "Inserted {count} folder reference(s)",
				"dropped.missed": "Could not locate {count} folder(s) in the current workspace. Use Add folder instead.",
				"dropped.partial": "Inserted {resolved}; {missed} not found in the workspace.",
				"noWorkspace": "This session has no working directory, so folders cannot be resolved.",
				"image.tooMany": "At most {count} images per message.",
				"image.fileTooLarge": "One or more images exceed the {size} per-image limit.",
				"image.totalTooLarge": "These images exceed the {size} per-message total."
			}
		};
		//#endregion

		//#region path grammar
		function trimTrailing(text) {
			return text.replace(/[/\\]+$/, "");
		}
		/**
		* Mirror the shipped `@file` mention grammar (dsh-file-reference/grammar):
		* a directory keeps its trailing slash; whitespace needs the quoted form.
		* @returns the token, or undefined when the grammar cannot carry the path.
		*/
		function formatMention(path) {
			if (/[\u0000-\u001f\u007f-\u009f"]/u.test(path)) return void 0;
			return /\s/u.test(path) ? `@"${path}"` : `@${path}`;
		}
		/**
		* Make an absolute host path workspace-relative so the mention reads
		* shorter and resolves from the workspace root. The root itself becomes
		* `.` (`@./`); anything not rooted there keeps its absolute form.
		*/
		function relativize(absolute, cwd) {
			if (cwd === void 0 || cwd === "") return absolute;
			const root = trimTrailing(cwd);
			if (absolute === root) return ".";
			return absolute.startsWith(`${root}/`) || absolute.startsWith(`${root}\\`) ? absolute.slice(root.length + 1) : absolute;
		}
		function messageOf(error) {
			if (error instanceof Error) return error.message;
			if (typeof error === "string") return error;
			if (typeof error === "object" && error !== null && "message" in error) return String(error.message);
			return String(error);
		}
		function basenameOf(path) {
			const trimmed = trimTrailing(path);
			const at = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
			return at === -1 ? trimmed : trimmed.slice(at + 1);
		}
		function depthOf(path) {
			return path.split("/").filter(Boolean).length;
		}
		//#endregion

		//#region folder resolution
		/**
		* Resolve a dropped folder's basename to a workspace path.
		*
		* A browser hands over only the name, so the lookup goes through the same
		* Remote the `@` completion menu uses: one call against the Host's reusable
		* fuzzy index, which already excludes vendored trees. An earlier revision
		* walked the tree with up to 400 sequential listings, which is why every
		* drop lost the race and reported no path.
		* @param list - the indexed candidate lookup for one query.
		* @param name - the dropped folder's basename.
		* @returns a unique workspace-relative path, or undefined when absent.
		*/
		async function resolveFolder(list, name) {
			let candidates;
			try {
				candidates = await list(name);
			} catch {
				return void 0;
			}
			if (candidates === void 0 || candidates === null) return void 0;
			const wanted = name.toLowerCase();
			const hits = [];
			for (const candidate of candidates) {
				if (candidate.kind !== "directory") continue;
				const path = trimTrailing(candidate.path);
				if (path === "" || basenameOf(path).toLowerCase() !== wanted) continue;
				if (!hits.includes(path)) hits.push(path);
			}
			if (hits.length === 0) return void 0;
			// Prefer the shallowest match (a Finder drop usually means the top-level
			// folder); only a tie at that same depth is genuinely ambiguous.
			const shallowest = hits.reduce((best, path) => Math.min(best, depthOf(path)), Infinity);
			const atDepth = hits.filter((path) => depthOf(path) === shallowest);
			return atDepth.length === 1 ? atDepth[0] : void 0;
		}
		//#endregion

		//#region folder verbs
		/**
		* Mirror the composer's client-side image pre-check for one dropped batch.
		*
		* The shipped `intakeFiles` runs this before uploading, but it is
		* InputBar-private and never rides the public `InputActions` face, so a
		* plugin that uploads on its own must re-apply the same rules or it would
		* silently skip them for mixed folder+image drops. Thresholds come from the
		* `imageLimits` projection — the same source the composer reads — never a
		* copy of the defaults.
		*
		* This counts only the dropped batch: already-attached images are not
		* visible through any public face. The Host's `validateImageBatch` still
		* enforces the full per-message limit, so this is an earlier, friendlier
		* message rather than the authority.
		* @returns a notice key and params, or undefined when the batch is fine.
		*/
		function imageBatchProblem(files, limits) {
			if (limits === void 0 || limits === null) return void 0;
			const images = files.filter((file) => limits.mediaTypes.includes(file.type));
			if (images.length === 0) return void 0;
			if (images.length > limits.maxImagesPerMessage) return {
				key: "image.tooMany",
				params: { count: limits.maxImagesPerMessage }
			};
			if (images.some((file) => file.size > limits.maxImageBytes)) return {
				key: "image.fileTooLarge",
				params: { size: _deepseek_ai_dsh_client_ui_primitives.fileSizeText(limits.maxImageBytes) }
			};
			if (images.reduce((sum, file) => sum + file.size, 0) > limits.maxMessageImageBytes) return {
				key: "image.totalTooLarge",
				params: { size: _deepseek_ai_dsh_client_ui_primitives.fileSizeText(limits.maxMessageImageBytes) }
			};
			return void 0;
		}
		/**
		* The host-backed ways to obtain a folder path from a plain browser.
		*
		* `pick` is always offered rather than capability-probed: the composed
		* backend answers it or refuses, and a refusal surfaces as a notice. A
		* pre-flight probe would have to classify the backend by an error code, and
		* mis-classifying it is what made the affordance vanish on a working
		* install.
		*/
		function createFolderApi(deps) {
			return {
				/**
				* Choose one folder on the host and insert it as a mention.
				* @returns the inserted token, or null when the operator cancelled.
				*/
				async pickAndInsert(sessionId) {
					const result = await deps.remote.directoryPicker.pick();
					if (!result.ok) throw new Error(messageOf(result.error));
					const chosen = result.value;
					if (chosen === null || chosen === void 0 || chosen === "") return null;
					const absolute = trimTrailing(chosen);
					const token = formatMention(`${relativize(absolute, deps.cwdOf(sessionId))}/`);
					if (token === void 0) throw new Error(`unsupported path: ${chosen}`);
					if (!deps.insert(sessionId, `${token} `)) throw new Error("composer is busy");
					return token;
				},
				/** Reference the workspace root — no dialog needed at all. */
				insertWorkspaceRoot(sessionId) {
					const cwd = deps.cwdOf(sessionId);
					if (cwd === void 0 || cwd === "") return false;
					return deps.insert(sessionId, "@./ ");
				},
				/**
				* Turn a folder drop/paste into mentions, and pass the remaining
				* members to the composer's own upload path.
				*
				* Resolution is awaited here rather than pre-computed for a
				* synchronous callback, so there is no timing contract to lose.
				*/
				async absorb(sessionId, files, folders) {
					const cwd = deps.cwdOf(sessionId);
					const list = async (query) => {
						const result = await deps.remote.fileReferences.list(sessionId, query);
						if (!result.ok) throw new Error(messageOf(result.error));
						return result.value;
					};
					const tokens = [];
					let missed = 0;
					for (const folder of folders) {
						if (cwd === void 0 || cwd === "") {
							missed += 1;
							continue;
						}
						const found = await resolveFolder(list, folder.name);
						// Candidates are already workspace-relative, so no relativize here.
						const token = found === void 0 ? void 0 : formatMention(`${found}/`);
						if (token === void 0) missed += 1;
						else tokens.push(token);
					}
					if (tokens.length > 0 && !deps.insert(sessionId, `${tokens.join(" ")} `)) missed += tokens.length;
					const rest = files.filter((file) => !folders.includes(file));
					if (rest.length > 0) deps.uploadFiles(sessionId, rest);
					return { resolved: tokens.length, missed };
				}
			};
		}
		//#endregion

		//#region gesture interception
		/** The composer card the shipped InputBar renders (its own DOM marker). */
		const CARD = "[data-composer-card]";
		/** Directory members of a drop/paste; the entry API is the only source. */
		function directoriesOf(dataTransfer, files) {
			const directories = [];
			let index = 0;
			for (const item of dataTransfer.items) {
				if (item.kind !== "file") continue;
				const file = files[index++];
				if (typeof item.webkitGetAsEntry !== "function") continue;
				const entry = item.webkitGetAsEntry();
				if (entry === null || entry === void 0 || entry.isDirectory !== true) continue;
				if (file !== void 0) directories.push(file);
			}
			return directories;
		}
		/**
		* Claim folder drops and folder pastes before the composer's own handler.
		*
		* The shipped listeners bind `drop` on `document` and `paste` on the editor
		* root, both in the bubble phase, so a capture-phase listener on `window`
		* runs first and can hand the gesture elsewhere. Anything that is not a
		* directory is left untouched, so images and files keep their behavior.
		*
		* Stopping a drop has one side effect that must be paid back: the shipped
		* `drop` handler is the only thing that clears the full-screen drop overlay,
		* so suppressing it strands that mask over the whole page (its `reset` is
		* also wired to `dragend`, which never fires here for a drag started in
		* Finder). Dispatching a synthetic `dragend` on `window` runs exactly that
		* reset — the handler reads no event data, and the reset is idempotent. An
		* earlier revision omitted this and left the UI stuck on the drop prompt.
		* @param handlers - session attribution plus the intake verb.
		* @returns a disposer removing exactly these listeners.
		*/
		function installFolderIntake(handlers) {
			if (typeof window === "undefined" || typeof Event !== "function") return () => {};
			const clearOverlay = () => {
				window.dispatchEvent(new Event("dragend"));
			};
			const claim = (event, dataTransfer, files) => {
				const folders = directoriesOf(dataTransfer, files);
				if (folders.length === 0) return false;
				const sessionId = handlers.resolve(event.target);
				if (sessionId === void 0) return false;
				event.preventDefault();
				event.stopPropagation();
				clearOverlay();
				handlers.consume(sessionId, files, folders);
				return true;
			};
			const onDrop = (event) => {
				const dataTransfer = event.dataTransfer;
				if (dataTransfer === null || !dataTransfer.types.includes("Files")) return;
				const files = [...dataTransfer.files];
				if (files.length === 0) return;
				claim(event, dataTransfer, files);
			};
			const onPaste = (event) => {
				const clipboardData = event.clipboardData;
				if (clipboardData === null) return;
				const files = [];
				for (const item of clipboardData.items) {
					if (item.kind !== "file") continue;
					const file = item.getAsFile();
					if (file !== null) files.push(file);
				}
				if (files.length === 0) return;
				claim(event, clipboardData, files);
			};
			window.addEventListener("drop", onDrop, true);
			window.addEventListener("paste", onPaste, true);
			return () => {
				window.removeEventListener("drop", onDrop, true);
				window.removeEventListener("paste", onPaste, true);
			};
		}
		//#endregion

		//#region composer surface
		/** A session-scoped notice, cleared by its owner after a delay. */
		function Notice(props) {
			const notice = react.useSyncExternalStore(props.noticeStore.subscribe, () => props.noticeStore.snapshot(props.sessionId), () => null);
			if (notice === null) return null;
			return (0, react_jsx_runtime.jsx)("span", {
				role: "status",
				style: {
					fontSize: "12px",
					lineHeight: "18px",
					color: notice.level === "error" ? "var(--dsw-alias-label-danger, var(--dsw-alias-label-secondary))" : "var(--dsw-alias-label-tertiary)",
					overflow: "hidden",
					textOverflow: "ellipsis",
					whiteSpace: "nowrap",
					maxWidth: "320px"
				},
				children: notice.text
			});
		}
		/**
		* One composer's folder affordance. `sessionId`, `inputActions` and `t`
		* arrive as standard slot props (the conversation plugin provides them for
		* the `session`-scoped `conversation.input.left` seat), so this entry needs
		* no private seam to write the draft.
		*/
		function FolderAttachEntry(props) {
			const sessionId = props.sessionId;
			const inputActions = props.inputActions;
			const t = props.t;
			const api = props.api;
			const noticeStore = props.noticeStore;
			const publishLimits = props.publishLimits;
			// The composer's own image limits, read from the same projection it
			// reads. `undefined` means the capability is absent (host unit
			// unmounted, or no baseline has carried the key yet), which the
			// pre-check treats as "cannot judge" rather than "unlimited".
			// Guarded so a renamed seam degrades to "cannot judge" instead of
			// throwing and taking the whole entry down with it. The call stays
			// unconditional, so hook order is stable either way.
			const useProjection = props.useProjection ?? (() => void 0);
			const imageLimits = useProjection("imageLimits");
			react.useEffect(() => {
				if (sessionId === void 0) return;
				publishLimits(sessionId, imageLimits);
			}, [sessionId, imageLimits, publishLimits]);
			const anchorRef = react.useRef(null);
			const [busy, setBusy] = react.useState(false);
			// Publish this composer (and the card owning it) while mounted, so the
			// shared verbs and the intercepted gesture address the visible draft.
			react.useEffect(() => {
				if (sessionId === void 0 || inputActions === void 0) return;
				const card = anchorRef.current === null ? null : anchorRef.current.closest(CARD);
				return props.report(sessionId, inputActions, card);
			}, [sessionId, inputActions, props.report]);
			const onClick = () => {
				if (sessionId === void 0 || busy) return;
				setBusy(true);
				api.pickAndInsert(sessionId).then((token) => {
					noticeStore.publish(sessionId, token === null ? "info" : "ok", token === null ? t("picked.none") : t("inserted", { count: 1 }));
				}, (error) => {
					noticeStore.publish(sessionId, "error", t("failed", { message: messageOf(error) }));
				}).finally(() => {
					setBusy(false);
				});
			};
			const enabled = sessionId !== void 0 && !busy;
			return (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, {
				children: [
					(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {
						label: busy ? t("button.picking") : t("button.hint"),
						side: "top",
						delayMs: 400,
						children: (0, react_jsx_runtime.jsxs)("button", {
							ref: anchorRef,
							type: "button",
							"aria-label": t("button.title"),
							disabled: !enabled,
							onMouseDown: (event) => {
								event.preventDefault();
							},
							onClick,
							style: {
								display: "inline-flex",
								alignItems: "center",
								gap: "4px",
								height: "26px",
								padding: "0 8px",
								margin: 0,
								border: "none",
								borderRadius: "var(--dsw-radius-sm, 6px)",
								background: "transparent",
								color: "var(--dsw-alias-label-secondary)",
								font: "inherit",
								fontSize: "12px",
								lineHeight: "18px",
								cursor: enabled ? "pointer" : "default",
								opacity: enabled ? 1 : 0.45,
								flex: "none"
							},
							children: [
								(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconFolderOpenOutlineRegular, { size: 14 }),
								(0, react_jsx_runtime.jsx)("span", { children: busy ? t("button.picking") : t("button.title") })
							]
						})
					}),
					(0, react_jsx_runtime.jsx)(Notice, {
						sessionId,
						noticeStore
					})
				]
			});
		}
		//#endregion

		//#region plugin body
		const inject = [
			"slots",
			"locale",
			"sessions",
			"conversation",
			"remote",
			"remote.directoryPicker",
			"remote.fileReferences",
			"commandUi"
		];
		/**
		* Client plugin body: give the browser what the Desktop-only folder gate
		* withholds — a host-side folder choice that arrives as a real path.
		* @param ctx - client root context.
		*/
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, dictionaries));
			const t = ctx.locale.bind(NS);
			// --- shared state -------------------------------------------------
			/** Mounted composers: their public InputActions and owning card. */
			const live = /* @__PURE__ */ new Map();
			const cards = /* @__PURE__ */ new WeakMap();
			/** Most recently mounted composer: the fallback intake target. */
			let last;
			let noticeSeq = 0;
			const notices = /* @__PURE__ */ new Map();
			const noticeTimers = /* @__PURE__ */ new Map();
			const noticeListeners = /* @__PURE__ */ new Set();
			const emitNotices = () => {
				for (const listener of noticeListeners) listener();
			};
			const publish = (sessionId, level, text) => {
				// A monotonic stamp, so repeating the same message still re-renders,
				// and a late timer can never clear a notice it did not set.
				notices.set(sessionId, {
					level,
					text,
					seq: ++noticeSeq
				});
				emitNotices();
				const previous = noticeTimers.get(sessionId);
				if (previous !== void 0) clearTimeout(previous);
				noticeTimers.set(sessionId, setTimeout(() => {
					noticeTimers.delete(sessionId);
					const current = notices.get(sessionId);
					if (current !== void 0 && current.seq === noticeSeq) {
						notices.delete(sessionId);
						emitNotices();
					}
				}, level === "error" ? 12000 : 5000));
			};
			// No ambient timer may outlive the fiber that armed it.
			ctx.effect(() => () => {
				for (const timer of noticeTimers.values()) clearTimeout(timer);
				noticeTimers.clear();
			});
			const noticeStore = {
				subscribe: (listener) => {
					noticeListeners.add(listener);
					return () => noticeListeners.delete(listener);
				},
				snapshot: (sessionId) => {
					if (sessionId === void 0) return null;
					return notices.get(sessionId) ?? null;
				},
				publish
			};
			const cwdOf = (sessionId) => ctx.sessions.list.getSnapshot().byId[sessionId]?.cwd;
			/**
			* Write mention text into one composer through its public InputActions.
			* With no selection the caret span resolves to the document end, so this
			* appends to any existing draft instead of replacing it.
			*/
			const insert = (sessionId, text) => {
				const actions = live.get(sessionId);
				if (actions === void 0) return false;
				try {
					return actions.insertText(text, actions.captureInsertion());
				} catch {
					return false;
				}
			};
			/** Send the non-folder members down the composer's own upload path. */
			const uploadFiles = (sessionId, files) => {
				const actions = live.get(sessionId);
				if (actions === void 0) return;
				const drafts = ctx.conversation.createDrafts(sessionId, files);
				if (drafts.length === 0) return;
				if (!actions.addAttachments(drafts.map((draft) => draft.id))) ctx.conversation.releaseDraftAttachments(drafts);
			};
			const api = createFolderApi({
				remote: ctx.remote,
				cwdOf,
				insert,
				uploadFiles
			});
			/** Per-composer image limits, read by the entry through the official projection. */
			const limitsBy = /* @__PURE__ */ new Map();
			/** Which session a gesture belongs to: its card first, else the last composer. */
			const resolveTarget = (node) => {
				const element = node instanceof Element ? node : null;
				const card = element === null ? null : element.closest(CARD);
				if (card !== null) {
					const owner = cards.get(card);
					if (owner !== void 0 && live.has(owner)) return owner;
				}
				return last !== void 0 && live.has(last) ? last : void 0;
			};
			ctx.effect(() => installFolderIntake({
				resolve: resolveTarget,
				consume: (sessionId, files, folders) => {
					// Mirror the composer's own pre-check: a batch that would be
					// rejected is rejected whole, before anything is uploaded or
					// inserted, so a mixed folder+image drop cannot slip past it.
					const problem = imageBatchProblem(files, limitsBy.get(sessionId));
					if (problem !== void 0) {
						publish(sessionId, "error", t(problem.key, problem.params));
						return;
					}
					api.absorb(sessionId, files, folders).then((outcome) => {
						if (cwdOf(sessionId) === void 0 || cwdOf(sessionId) === "") {
							publish(sessionId, "error", t("noWorkspace"));
						} else if (outcome.resolved > 0 && outcome.missed === 0) {
							publish(sessionId, "ok", t("inserted", { count: outcome.resolved }));
						} else if (outcome.resolved > 0) {
							publish(sessionId, "error", t("dropped.partial", {
								resolved: outcome.resolved,
								missed: outcome.missed
							}));
						} else {
							publish(sessionId, "error", t("dropped.missed", { count: outcome.missed }));
						}
					}, (error) => {
						publish(sessionId, "error", t("failed", { message: messageOf(error) }));
					});
				}
			}));
			// --- composer entry ------------------------------------------------
			ctx.slots.inject("conversation.input.left", () => ctx.slots.register({
				name: "conversation.input.left",
				id: "folder-attach",
				order: 110,
				label: () => t("button.title"),
				locale: NS,
				inject: () => ({
					api,
					noticeStore,
					publishLimits: (sessionId, limits) => {
						if (limits === void 0) limitsBy.delete(sessionId);
						else limitsBy.set(sessionId, limits);
					},
					report: (sessionId, inputActions, card) => {
						live.set(sessionId, inputActions);
						last = sessionId;
						if (card !== null && card !== void 0) cards.set(card, sessionId);
						return () => {
							if (live.get(sessionId) === inputActions) live.delete(sessionId);
							limitsBy.delete(sessionId);
							if (last === sessionId) {
								const next = [...live.keys()];
								last = next.length === 0 ? void 0 : next[next.length - 1];
							}
						};
					}
				})
			}, FolderAttachEntry));
			// --- /folder -------------------------------------------------------
			ctx.effect(() => ctx.commandUi.register({
				name: "folder",
				label: () => t("command.label"),
				description: () => t("command.description"),
				icon: _deepseek_ai_dsh_client_ui_primitives.IconFolderOpenOutlineRegular,
				available: () => true,
				ui: {
					kind: "action",
					run: (session) => {
						const sessionId = session.sessionId;
						api.pickAndInsert(sessionId).then((token) => {
							publish(sessionId, "info", token === null ? t("picked.none") : t("inserted", { count: 1 }));
						}, (error) => {
							publish(sessionId, "error", t("failed", { message: messageOf(error) }));
						});
					}
				}
			}));
		}
		//#endregion

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
