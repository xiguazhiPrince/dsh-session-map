window.__ModuleLoader__.load({
	id: "dsh-session-map",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		//#region \0rolldown/runtime.js
		var __create = Object.create;
		var __defProp = Object.defineProperty;
		var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
		var __getOwnPropNames = Object.getOwnPropertyNames;
		var __getProtoOf = Object.getPrototypeOf;
		var __hasOwnProp = Object.prototype.hasOwnProperty;
		var __copyProps = (to, from, except, desc) => {
			if (from && typeof from === "object" || typeof from === "function") for (var keys = __getOwnPropNames(from), i = 0, n = keys.length, key; i < n; i++) {
				key = keys[i];
				if (!__hasOwnProp.call(to, key) && key !== except) __defProp(to, key, {
					get: ((k) => from[k]).bind(null, key),
					enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
				});
			}
			return to;
		};
		var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(isNodeMode || !mod || !mod.__esModule || !__hasOwnProp.call(mod, "default") ? __defProp(target, "default", {
			value: mod,
			enumerable: true
		}) : target, mod));
		//#endregion
		let react = require("react");
		react = __toESM(react, 1);
		//#region src/client/index.ts
		/**
		* Browser half: the Session map plugin.
		*
		* This scaffold registers one Conversation tab, so the install path can be
		* verified end to end before the canvas is ported in. Services are read through
		* `ctx.get` against local structural types rather than the product's own
		* browser packages: those are published at a prerelease version, and this
		* repository deliberately does not pin them.
		*/
		/** Plugin name the Loader reports for this bundle's browser half. */
		const name = "dsh-session-map";
		/** Hard dependency: there is nothing to register into before the slot registry exists. */
		const inject = ["slots"];
		/**
		* One Conversation tab.
		* @param props - composed slot props.
		* @returns the tab body.
		*/
		function SessionMapTab(props) {
			const count = props.useSessions((state) => state.ids.length);
			const current = props.useSessions((state) => state.current);
			return react.createElement("div", { style: {
				padding: "24px 28px",
				fontSize: 13,
				lineHeight: 1.6
			} }, react.createElement("div", { style: {
				fontSize: 15,
				fontWeight: 600
			} }, "会话图谱"), react.createElement("div", { style: { color: "var(--dsw-alias-label-secondary)" } }, `${String(count)} 个会话 · 当前 ${current ?? "未选择"}`));
		}
		/**
		* Client plugin body: register the Conversation tab.
		*
		* The registry's own `provide` name is the argument here; the property face the
		* product's packages declare does not exist in this program, so the lookup goes
		* through a structural view of the context.
		* @param ctx - browser root context.
		*/
		function apply(ctx) {
			const slots = ctx.get("slots");
			if (slots === void 0) return;
			ctx.effect(() => slots.inject("conversation.view", () => slots.register({
				name: "conversation.view",
				id: "session-map",
				order: 30,
				label: "会话图谱"
			}, SessionMapTab)), "session-map: conversation view entry");
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		exports.name = name;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map