function noop() { }
function assign(tar, src) {
    // @ts-ignore
    for (const k in src)
        tar[k] = src[k];
    return tar;
}
function run(fn) {
    return fn();
}
function blank_object() {
    return Object.create(null);
}
function run_all(fns) {
    fns.forEach(run);
}
function is_function(thing) {
    return typeof thing === 'function';
}
function safe_not_equal(a, b) {
    return a != a ? b == b : a !== b || ((a && typeof a === 'object') || typeof a === 'function');
}
function subscribe(store, ...callbacks) {
    if (store == null) {
        return noop;
    }
    const unsub = store.subscribe(...callbacks);
    return unsub.unsubscribe ? () => unsub.unsubscribe() : unsub;
}
function component_subscribe(component, store, callback) {
    component.$$.on_destroy.push(subscribe(store, callback));
}
function create_slot(definition, ctx, $$scope, fn) {
    if (definition) {
        const slot_ctx = get_slot_context(definition, ctx, $$scope, fn);
        return definition[0](slot_ctx);
    }
}
function get_slot_context(definition, ctx, $$scope, fn) {
    return definition[1] && fn
        ? assign($$scope.ctx.slice(), definition[1](fn(ctx)))
        : $$scope.ctx;
}
function get_slot_changes(definition, $$scope, dirty, fn) {
    if (definition[2] && fn) {
        const lets = definition[2](fn(dirty));
        if ($$scope.dirty === undefined) {
            return lets;
        }
        if (typeof lets === 'object') {
            const merged = [];
            const len = Math.max($$scope.dirty.length, lets.length);
            for (let i = 0; i < len; i += 1) {
                merged[i] = $$scope.dirty[i] | lets[i];
            }
            return merged;
        }
        return $$scope.dirty | lets;
    }
    return $$scope.dirty;
}
function update_slot(slot, slot_definition, ctx, $$scope, dirty, get_slot_changes_fn, get_slot_context_fn) {
    const slot_changes = get_slot_changes(slot_definition, $$scope, dirty, get_slot_changes_fn);
    if (slot_changes) {
        const slot_context = get_slot_context(slot_definition, ctx, $$scope, get_slot_context_fn);
        slot.p(slot_context, slot_changes);
    }
}

function append(target, node) {
    target.appendChild(node);
}
function insert(target, node, anchor) {
    target.insertBefore(node, anchor || null);
}
function detach(node) {
    node.parentNode.removeChild(node);
}
function element(name) {
    return document.createElement(name);
}
function listen(node, event, handler, options) {
    node.addEventListener(event, handler, options);
    return () => node.removeEventListener(event, handler, options);
}
function attr(node, attribute, value) {
    if (value == null)
        node.removeAttribute(attribute);
    else if (node.getAttribute(attribute) !== value)
        node.setAttribute(attribute, value);
}
function children(element) {
    return Array.from(element.childNodes);
}
function toggle_class(element, name, toggle) {
    element.classList[toggle ? 'add' : 'remove'](name);
}
function custom_event(type, detail) {
    const e = document.createEvent('CustomEvent');
    e.initCustomEvent(type, false, false, detail);
    return e;
}

let current_component;
function set_current_component(component) {
    current_component = component;
}
function get_current_component() {
    if (!current_component)
        throw new Error(`Function called outside component initialization`);
    return current_component;
}
function onMount(fn) {
    get_current_component().$$.on_mount.push(fn);
}
function afterUpdate(fn) {
    get_current_component().$$.after_update.push(fn);
}
function onDestroy(fn) {
    get_current_component().$$.on_destroy.push(fn);
}
function createEventDispatcher() {
    const component = get_current_component();
    return (type, detail) => {
        const callbacks = component.$$.callbacks[type];
        if (callbacks) {
            // TODO are there situations where events could be dispatched
            // in a server (non-DOM) environment?
            const event = custom_event(type, detail);
            callbacks.slice().forEach(fn => {
                fn.call(component, event);
            });
        }
    };
}
function setContext(key, context) {
    get_current_component().$$.context.set(key, context);
}
function getContext(key) {
    return get_current_component().$$.context.get(key);
}

const dirty_components = [];
const binding_callbacks = [];
const render_callbacks = [];
const flush_callbacks = [];
const resolved_promise = Promise.resolve();
let update_scheduled = false;
function schedule_update() {
    if (!update_scheduled) {
        update_scheduled = true;
        resolved_promise.then(flush);
    }
}
function tick() {
    schedule_update();
    return resolved_promise;
}
function add_render_callback(fn) {
    render_callbacks.push(fn);
}
let flushing = false;
const seen_callbacks = new Set();
function flush() {
    if (flushing)
        return;
    flushing = true;
    do {
        // first, call beforeUpdate functions
        // and update components
        for (let i = 0; i < dirty_components.length; i += 1) {
            const component = dirty_components[i];
            set_current_component(component);
            update(component.$$);
        }
        dirty_components.length = 0;
        while (binding_callbacks.length)
            binding_callbacks.pop()();
        // then, once components are updated, call
        // afterUpdate functions. This may cause
        // subsequent updates...
        for (let i = 0; i < render_callbacks.length; i += 1) {
            const callback = render_callbacks[i];
            if (!seen_callbacks.has(callback)) {
                // ...so guard against infinite loops
                seen_callbacks.add(callback);
                callback();
            }
        }
        render_callbacks.length = 0;
    } while (dirty_components.length);
    while (flush_callbacks.length) {
        flush_callbacks.pop()();
    }
    update_scheduled = false;
    flushing = false;
    seen_callbacks.clear();
}
function update($$) {
    if ($$.fragment !== null) {
        $$.update();
        run_all($$.before_update);
        const dirty = $$.dirty;
        $$.dirty = [-1];
        $$.fragment && $$.fragment.p($$.ctx, dirty);
        $$.after_update.forEach(add_render_callback);
    }
}
const outroing = new Set();
let outros;
function group_outros() {
    outros = {
        r: 0,
        c: [],
        p: outros // parent group
    };
}
function check_outros() {
    if (!outros.r) {
        run_all(outros.c);
    }
    outros = outros.p;
}
function transition_in(block, local) {
    if (block && block.i) {
        outroing.delete(block);
        block.i(local);
    }
}
function transition_out(block, local, detach, callback) {
    if (block && block.o) {
        if (outroing.has(block))
            return;
        outroing.add(block);
        outros.c.push(() => {
            outroing.delete(block);
            if (callback) {
                if (detach)
                    block.d(1);
                callback();
            }
        });
        block.o(local);
    }
}
function mount_component(component, target, anchor) {
    const { fragment, on_mount, on_destroy, after_update } = component.$$;
    fragment && fragment.m(target, anchor);
    // onMount happens before the initial afterUpdate
    add_render_callback(() => {
        const new_on_destroy = on_mount.map(run).filter(is_function);
        if (on_destroy) {
            on_destroy.push(...new_on_destroy);
        }
        else {
            // Edge case - component was destroyed immediately,
            // most likely as a result of a binding initialising
            run_all(new_on_destroy);
        }
        component.$$.on_mount = [];
    });
    after_update.forEach(add_render_callback);
}
function destroy_component(component, detaching) {
    const $$ = component.$$;
    if ($$.fragment !== null) {
        run_all($$.on_destroy);
        $$.fragment && $$.fragment.d(detaching);
        // TODO null out other refs, including component.$$ (but need to
        // preserve final state?)
        $$.on_destroy = $$.fragment = null;
        $$.ctx = [];
    }
}
function make_dirty(component, i) {
    if (component.$$.dirty[0] === -1) {
        dirty_components.push(component);
        schedule_update();
        component.$$.dirty.fill(0);
    }
    component.$$.dirty[(i / 31) | 0] |= (1 << (i % 31));
}
function init(component, options, instance, create_fragment, not_equal, props, dirty = [-1]) {
    const parent_component = current_component;
    set_current_component(component);
    const prop_values = options.props || {};
    const $$ = component.$$ = {
        fragment: null,
        ctx: null,
        // state
        props,
        update: noop,
        not_equal,
        bound: blank_object(),
        // lifecycle
        on_mount: [],
        on_destroy: [],
        before_update: [],
        after_update: [],
        context: new Map(parent_component ? parent_component.$$.context : []),
        // everything else
        callbacks: blank_object(),
        dirty
    };
    let ready = false;
    $$.ctx = instance
        ? instance(component, prop_values, (i, ret, ...rest) => {
            const value = rest.length ? rest[0] : ret;
            if ($$.ctx && not_equal($$.ctx[i], $$.ctx[i] = value)) {
                if ($$.bound[i])
                    $$.bound[i](value);
                if (ready)
                    make_dirty(component, i);
            }
            return ret;
        })
        : [];
    $$.update();
    ready = true;
    run_all($$.before_update);
    // `false` as a special case of no DOM component
    $$.fragment = create_fragment ? create_fragment($$.ctx) : false;
    if (options.target) {
        if (options.hydrate) {
            const nodes = children(options.target);
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            $$.fragment && $$.fragment.l(nodes);
            nodes.forEach(detach);
        }
        else {
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            $$.fragment && $$.fragment.c();
        }
        if (options.intro)
            transition_in(component.$$.fragment);
        mount_component(component, options.target, options.anchor);
        flush();
    }
    set_current_component(parent_component);
}
class SvelteComponent {
    $destroy() {
        destroy_component(this, 1);
        this.$destroy = noop;
    }
    $on(type, callback) {
        const callbacks = (this.$$.callbacks[type] || (this.$$.callbacks[type] = []));
        callbacks.push(callback);
        return () => {
            const index = callbacks.indexOf(callback);
            if (index !== -1)
                callbacks.splice(index, 1);
        };
    }
    $set() {
        // overridden by instance, if it has props
    }
}

let id = 1;

function getId() {
  return `svelte-tabs-${id++}`;
}

const subscriber_queue = [];
/**
 * Create a `Writable` store that allows both updating and reading by subscription.
 * @param {*=}value initial value
 * @param {StartStopNotifier=}start start and stop notifications for subscriptions
 */
function writable(value, start = noop) {
    let stop;
    const subscribers = [];
    function set(new_value) {
        if (safe_not_equal(value, new_value)) {
            value = new_value;
            if (stop) { // store is ready
                const run_queue = !subscriber_queue.length;
                for (let i = 0; i < subscribers.length; i += 1) {
                    const s = subscribers[i];
                    s[1]();
                    subscriber_queue.push(s, value);
                }
                if (run_queue) {
                    for (let i = 0; i < subscriber_queue.length; i += 2) {
                        subscriber_queue[i][0](subscriber_queue[i + 1]);
                    }
                    subscriber_queue.length = 0;
                }
            }
        }
    }
    function update(fn) {
        set(fn(value));
    }
    function subscribe(run, invalidate = noop) {
        const subscriber = [run, invalidate];
        subscribers.push(subscriber);
        if (subscribers.length === 1) {
            stop = start(set) || noop;
        }
        run(value);
        return () => {
            const index = subscribers.indexOf(subscriber);
            if (index !== -1) {
                subscribers.splice(index, 1);
            }
            if (subscribers.length === 0) {
                stop();
                stop = null;
            }
        };
    }
    return { set, update, subscribe };
}

/* src/Tabs.svelte generated by Svelte v3.24.0 */

function create_fragment(ctx) {
	let div;
	let current;
	let mounted;
	let dispose;
	const default_slot_template = /*$$slots*/ ctx[4].default;
	const default_slot = create_slot(default_slot_template, ctx, /*$$scope*/ ctx[3], null);

	return {
		c() {
			div = element("div");
			if (default_slot) default_slot.c();
			attr(div, "class", "svelte-tabs");
		},
		m(target, anchor) {
			insert(target, div, anchor);

			if (default_slot) {
				default_slot.m(div, null);
			}

			current = true;

			if (!mounted) {
				dispose = listen(div, "keydown", /*handleKeyDown*/ ctx[1]);
				mounted = true;
			}
		},
		p(ctx, [dirty]) {
			if (default_slot) {
				if (default_slot.p && dirty & /*$$scope*/ 8) {
					update_slot(default_slot, default_slot_template, ctx, /*$$scope*/ ctx[3], dirty, null, null);
				}
			}
		},
		i(local) {
			if (current) return;
			transition_in(default_slot, local);
			current = true;
		},
		o(local) {
			transition_out(default_slot, local);
			current = false;
		},
		d(detaching) {
			if (detaching) detach(div);
			if (default_slot) default_slot.d(detaching);
			mounted = false;
			dispose();
		}
	};
}

const TABS = {};

function removeAndUpdateSelected(arr, item, selectedStore) {
	const index = arr.indexOf(item);
	arr.splice(index, 1);

	selectedStore.update(selected => selected === item
	? arr[index] || arr[arr.length - 1]
	: selected);
}

function instance($$self, $$props, $$invalidate) {
	let $selectedTab;
	let { selectedTabIndex = 0 } = $$props;
	const dispatch = createEventDispatcher();
	const tabElements = [];
	const tabs = [];
	const panels = [];
	const controls = writable({});
	const labeledBy = writable({});
	const selectedTab = writable(null);
	component_subscribe($$self, selectedTab, value => $$invalidate(5, $selectedTab = value));
	const selectedPanel = writable(null);

	function registerItem(arr, item, selectedStore) {
		arr.push(item);
		selectedStore.update(selected => selected || item);
		onDestroy(() => removeAndUpdateSelected(arr, item, selectedStore));
	}

	function selectTab(tab) {
		$$invalidate(2, selectedTabIndex = tabs.indexOf(tab));
		selectedTab.set(tab);
		selectedPanel.set(panels[selectedTabIndex]);
		dispatch("tabSelected", { tab, selectedTabIndex });
	}

	setContext(TABS, {
		registerTab(tab) {
			registerItem(tabs, tab, selectedTab);
		},
		registerTabElement(tabElement) {
			tabElements.push(tabElement);
		},
		registerPanel(panel) {
			registerItem(panels, panel, selectedPanel);
		},
		selectTab,
		selectedTab,
		selectedPanel,
		controls,
		labeledBy
	});

	onMount(() => {
		selectTab(tabs[selectedTabIndex]);
	});

	afterUpdate(() => {
		for (let i = 0; i < tabs.length; i++) {
			controls.update(controlsData => ({
				...controlsData,
				[tabs[i].id]: panels[i].id
			}));

			labeledBy.update(labeledByData => ({
				...labeledByData,
				[panels[i].id]: tabs[i].id
			}));
		}
	});

	async function handleKeyDown(event) {
		if (event.target.classList.contains("svelte-tabs__tab")) {
			let selectedIndex = tabs.indexOf($selectedTab);

			switch (event.key) {
				case "ArrowRight":
					selectedIndex += 1;
					if (selectedIndex > tabs.length - 1) {
						selectedIndex = 0;
					}
					selectTab(tabs[selectedIndex]);
					tabElements[selectedIndex].focus();
					break;
				case "ArrowLeft":
					selectedIndex -= 1;
					if (selectedIndex < 0) {
						selectedIndex = tabs.length - 1;
					}
					selectTab(tabs[selectedIndex]);
					tabElements[selectedIndex].focus();
			}
		}
	}

	let { $$slots = {}, $$scope } = $$props;

	$$self.$set = $$props => {
		if ("selectedTabIndex" in $$props) $$invalidate(2, selectedTabIndex = $$props.selectedTabIndex);
		if ("$$scope" in $$props) $$invalidate(3, $$scope = $$props.$$scope);
	};

	$$self.$$.update = () => {
		if ($$self.$$.dirty & /*selectedTabIndex*/ 4) ;
	};

	return [selectedTab, handleKeyDown, selectedTabIndex, $$scope, $$slots];
}

class Tabs extends SvelteComponent {
	constructor(options) {
		super();
		init(this, options, instance, create_fragment, safe_not_equal, { selectedTabIndex: 2 });
	}
}

/* src/Tab.svelte generated by Svelte v3.24.0 */

function add_css() {
	var style = element("style");
	style.id = "svelte-1fbofsd-style";
	style.textContent = ".svelte-tabs__tab.svelte-1fbofsd{border:none;border-bottom:2px solid transparent;color:#000000;cursor:pointer;list-style:none;display:inline-block;padding:0.5em 0.75em}.svelte-tabs__tab.svelte-1fbofsd:focus{outline:thin dotted}.svelte-tabs__selected.svelte-1fbofsd{border-bottom:2px solid #4F81E5;color:#4F81E5}";
	append(document.head, style);
}

function create_fragment$1(ctx) {
	let li;
	let li_id_value;
	let li_aria_controls_value;
	let li_tabindex_value;
	let current;
	let mounted;
	let dispose;
	const default_slot_template = /*$$slots*/ ctx[8].default;
	const default_slot = create_slot(default_slot_template, ctx, /*$$scope*/ ctx[7], null);

	return {
		c() {
			li = element("li");
			if (default_slot) default_slot.c();
			attr(li, "role", "tab");
			attr(li, "id", li_id_value = /*tab*/ ctx[3].id);
			attr(li, "aria-controls", li_aria_controls_value = /*$controls*/ ctx[2][/*tab*/ ctx[3].id]);
			attr(li, "aria-selected", /*isSelected*/ ctx[1]);
			attr(li, "tabindex", li_tabindex_value = /*isSelected*/ ctx[1] ? 0 : -1);
			attr(li, "class", "svelte-tabs__tab svelte-1fbofsd");
			toggle_class(li, "svelte-tabs__selected", /*isSelected*/ ctx[1]);
		},
		m(target, anchor) {
			insert(target, li, anchor);

			if (default_slot) {
				default_slot.m(li, null);
			}

			/*li_binding*/ ctx[9](li);
			current = true;

			if (!mounted) {
				dispose = listen(li, "click", /*click_handler*/ ctx[10]);
				mounted = true;
			}
		},
		p(ctx, [dirty]) {
			if (default_slot) {
				if (default_slot.p && dirty & /*$$scope*/ 128) {
					update_slot(default_slot, default_slot_template, ctx, /*$$scope*/ ctx[7], dirty, null, null);
				}
			}

			if (!current || dirty & /*$controls*/ 4 && li_aria_controls_value !== (li_aria_controls_value = /*$controls*/ ctx[2][/*tab*/ ctx[3].id])) {
				attr(li, "aria-controls", li_aria_controls_value);
			}

			if (!current || dirty & /*isSelected*/ 2) {
				attr(li, "aria-selected", /*isSelected*/ ctx[1]);
			}

			if (!current || dirty & /*isSelected*/ 2 && li_tabindex_value !== (li_tabindex_value = /*isSelected*/ ctx[1] ? 0 : -1)) {
				attr(li, "tabindex", li_tabindex_value);
			}

			if (dirty & /*isSelected*/ 2) {
				toggle_class(li, "svelte-tabs__selected", /*isSelected*/ ctx[1]);
			}
		},
		i(local) {
			if (current) return;
			transition_in(default_slot, local);
			current = true;
		},
		o(local) {
			transition_out(default_slot, local);
			current = false;
		},
		d(detaching) {
			if (detaching) detach(li);
			if (default_slot) default_slot.d(detaching);
			/*li_binding*/ ctx[9](null);
			mounted = false;
			dispose();
		}
	};
}

function instance$1($$self, $$props, $$invalidate) {
	let $selectedTab;
	let $controls;
	let tabEl;
	const tab = { id: getId() };
	const { registerTab, registerTabElement, selectTab, selectedTab, controls } = getContext(TABS);
	component_subscribe($$self, selectedTab, value => $$invalidate(11, $selectedTab = value));
	component_subscribe($$self, controls, value => $$invalidate(2, $controls = value));
	let isSelected;
	registerTab(tab);

	onMount(async () => {
		await tick();
		registerTabElement(tabEl);
	});

	let { $$slots = {}, $$scope } = $$props;

	function li_binding($$value) {
		binding_callbacks[$$value ? "unshift" : "push"](() => {
			tabEl = $$value;
			$$invalidate(0, tabEl);
		});
	}

	const click_handler = () => selectTab(tab);

	$$self.$set = $$props => {
		if ("$$scope" in $$props) $$invalidate(7, $$scope = $$props.$$scope);
	};

	$$self.$$.update = () => {
		if ($$self.$$.dirty & /*$selectedTab*/ 2048) {
			 $$invalidate(1, isSelected = $selectedTab === tab);
		}
	};

	return [
		tabEl,
		isSelected,
		$controls,
		tab,
		selectTab,
		selectedTab,
		controls,
		$$scope,
		$$slots,
		li_binding,
		click_handler
	];
}

class Tab extends SvelteComponent {
	constructor(options) {
		super();
		if (!document.getElementById("svelte-1fbofsd-style")) add_css();
		init(this, options, instance$1, create_fragment$1, safe_not_equal, {});
	}
}

/* src/TabList.svelte generated by Svelte v3.24.0 */

function add_css$1() {
	var style = element("style");
	style.id = "svelte-12yby2a-style";
	style.textContent = ".svelte-tabs__tab-list.svelte-12yby2a{border-bottom:1px solid #CCCCCC;margin:0;padding:0}";
	append(document.head, style);
}

function create_fragment$2(ctx) {
	let ul;
	let current;
	const default_slot_template = /*$$slots*/ ctx[1].default;
	const default_slot = create_slot(default_slot_template, ctx, /*$$scope*/ ctx[0], null);

	return {
		c() {
			ul = element("ul");
			if (default_slot) default_slot.c();
			attr(ul, "role", "tablist");
			attr(ul, "class", "svelte-tabs__tab-list svelte-12yby2a");
		},
		m(target, anchor) {
			insert(target, ul, anchor);

			if (default_slot) {
				default_slot.m(ul, null);
			}

			current = true;
		},
		p(ctx, [dirty]) {
			if (default_slot) {
				if (default_slot.p && dirty & /*$$scope*/ 1) {
					update_slot(default_slot, default_slot_template, ctx, /*$$scope*/ ctx[0], dirty, null, null);
				}
			}
		},
		i(local) {
			if (current) return;
			transition_in(default_slot, local);
			current = true;
		},
		o(local) {
			transition_out(default_slot, local);
			current = false;
		},
		d(detaching) {
			if (detaching) detach(ul);
			if (default_slot) default_slot.d(detaching);
		}
	};
}

function instance$2($$self, $$props, $$invalidate) {
	let { $$slots = {}, $$scope } = $$props;

	$$self.$set = $$props => {
		if ("$$scope" in $$props) $$invalidate(0, $$scope = $$props.$$scope);
	};

	return [$$scope, $$slots];
}

class TabList extends SvelteComponent {
	constructor(options) {
		super();
		if (!document.getElementById("svelte-12yby2a-style")) add_css$1();
		init(this, options, instance$2, create_fragment$2, safe_not_equal, {});
	}
}

/* src/TabPanel.svelte generated by Svelte v3.24.0 */

function add_css$2() {
	var style = element("style");
	style.id = "svelte-epfyet-style";
	style.textContent = ".svelte-tabs__tab-panel.svelte-epfyet{margin-top:0.5em}";
	append(document.head, style);
}

// (26:2) {#if $selectedPanel === panel}
function create_if_block(ctx) {
	let current;
	const default_slot_template = /*$$slots*/ ctx[6].default;
	const default_slot = create_slot(default_slot_template, ctx, /*$$scope*/ ctx[5], null);

	return {
		c() {
			if (default_slot) default_slot.c();
		},
		m(target, anchor) {
			if (default_slot) {
				default_slot.m(target, anchor);
			}

			current = true;
		},
		p(ctx, dirty) {
			if (default_slot) {
				if (default_slot.p && dirty & /*$$scope*/ 32) {
					update_slot(default_slot, default_slot_template, ctx, /*$$scope*/ ctx[5], dirty, null, null);
				}
			}
		},
		i(local) {
			if (current) return;
			transition_in(default_slot, local);
			current = true;
		},
		o(local) {
			transition_out(default_slot, local);
			current = false;
		},
		d(detaching) {
			if (default_slot) default_slot.d(detaching);
		}
	};
}

function create_fragment$3(ctx) {
	let div;
	let div_id_value;
	let div_aria_labelledby_value;
	let current;
	let if_block = /*$selectedPanel*/ ctx[1] === /*panel*/ ctx[2] && create_if_block(ctx);

	return {
		c() {
			div = element("div");
			if (if_block) if_block.c();
			attr(div, "id", div_id_value = /*panel*/ ctx[2].id);
			attr(div, "aria-labelledby", div_aria_labelledby_value = /*$labeledBy*/ ctx[0][/*panel*/ ctx[2].id]);
			attr(div, "class", "svelte-tabs__tab-panel svelte-epfyet");
			attr(div, "role", "tabpanel");
		},
		m(target, anchor) {
			insert(target, div, anchor);
			if (if_block) if_block.m(div, null);
			current = true;
		},
		p(ctx, [dirty]) {
			if (/*$selectedPanel*/ ctx[1] === /*panel*/ ctx[2]) {
				if (if_block) {
					if_block.p(ctx, dirty);

					if (dirty & /*$selectedPanel*/ 2) {
						transition_in(if_block, 1);
					}
				} else {
					if_block = create_if_block(ctx);
					if_block.c();
					transition_in(if_block, 1);
					if_block.m(div, null);
				}
			} else if (if_block) {
				group_outros();

				transition_out(if_block, 1, 1, () => {
					if_block = null;
				});

				check_outros();
			}

			if (!current || dirty & /*$labeledBy*/ 1 && div_aria_labelledby_value !== (div_aria_labelledby_value = /*$labeledBy*/ ctx[0][/*panel*/ ctx[2].id])) {
				attr(div, "aria-labelledby", div_aria_labelledby_value);
			}
		},
		i(local) {
			if (current) return;
			transition_in(if_block);
			current = true;
		},
		o(local) {
			transition_out(if_block);
			current = false;
		},
		d(detaching) {
			if (detaching) detach(div);
			if (if_block) if_block.d();
		}
	};
}

function instance$3($$self, $$props, $$invalidate) {
	let $labeledBy;
	let $selectedPanel;
	const panel = { id: getId() };
	const { registerPanel, selectedPanel, labeledBy } = getContext(TABS);
	component_subscribe($$self, selectedPanel, value => $$invalidate(1, $selectedPanel = value));
	component_subscribe($$self, labeledBy, value => $$invalidate(0, $labeledBy = value));
	registerPanel(panel);
	let { $$slots = {}, $$scope } = $$props;

	$$self.$set = $$props => {
		if ("$$scope" in $$props) $$invalidate(5, $$scope = $$props.$$scope);
	};

	return [$labeledBy, $selectedPanel, panel, selectedPanel, labeledBy, $$scope, $$slots];
}

class TabPanel extends SvelteComponent {
	constructor(options) {
		super();
		if (!document.getElementById("svelte-epfyet-style")) add_css$2();
		init(this, options, instance$3, create_fragment$3, safe_not_equal, {});
	}
}

export { Tab, TabList, TabPanel, Tabs };
