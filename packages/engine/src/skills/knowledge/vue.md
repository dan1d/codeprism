# Vue.js Best Practices

> Curated conventions used by codeprism to seed code_style and rules documentation.
> Project-specific patterns discovered during indexing extend or override these baselines.

## Architecture

- **Module-based development**: Build apps from small, self-contained components that follow FIRST principles (Focused, Independent, Reusable, Small, Testable)
- **Single responsibility per component**: Each component should do one thing well; split components exceeding ~100 lines of code into smaller units
- **Component isolation**: Design components to work standalone with their own demos; avoid tight coupling to parent components or global state
- **Multi-word component names**: Use PascalCase for component definitions and kebab-case in templates (e.g., `UserList` / `<user-list>`) to comply with custom element specs
- **Generic component prefixing**: Namespace highly reusable single-word components with `app-` (e.g., `<app-header>`) to avoid conflicts and enable cross-project reuse
- **Primitive props**: Pass primitive values (strings, numbers, booleans) as props rather than complex objects to maintain clear component interfaces and enable better prop validation
- **Scoped styles**: Use component names as style scopes (via `scoped` attribute or BEM-like naming) to prevent style leakage between components
- **View-logic separation**: Keep components focused on view logic; extract business logic into separate modules/services for better testability and reuse

## Code Style

- **Simple template expressions**: Keep template expressions simple; extract complex logic into computed properties or methods rather than inline in templates
- **Validated props**: Always harness props with type validation, required flags, and default values using Vue's prop validation API
- **Avoid `this.$parent`**: Never access parent component state or methods via `this.$parent`; use props down, events up pattern instead
- **Kebab-case event names**: Emit events using kebab-case naming (e.g., `this.$emit('update-item')`) for consistency with HTML attribute conventions
- **Component structure order**: Organize Single File Components in consistent order: `<template>`, `<script>`, `<style>`; within script, order properties logically (name, props, data, computed, methods, lifecycle hooks)
- **`this.$refs` with caution**: Use refs sparingly and only for direct DOM manipulation; prefer declarative data binding and component communication via props/events
- **Meaningful, pronounceable names**: Use 2-3 word component names that are meaningful, pronounceable, and not overly specific or abstract
- **Avoid `this` aliasing**: Do not assign `this` to variables like `component` or `vm` in modern Vue; use arrow functions or proper binding instead

## Testing

- **Component isolation testing**: Test each component in isolation with standalone demos to verify independent functionality
- **Testable component design**: Structure components to be FIRST-compliant, making them inherently easier to unit test
- **Primitive prop testing**: Validate that components correctly handle all prop types, defaults, and validation rules
- **Event emission verification**: Test that components emit expected events with correct payloads in response to user interactions
- **Computed property coverage**: Unit test computed properties separately from template rendering to verify business logic
- **Avoid testing implementation details**: Test component public API (props, events, slots) rather than internal state or private methods

## Performance

- **Component granularity**: Keep components small (<100 LOC) to reduce re-render costs and enable better code-splitting
- **Computed properties for derived state**: Use computed properties instead of methods for values derived from reactive data; leverage Vue's caching
- **Primitive props for change detection**: Pass primitive props rather than objects to enable more efficient change detection and reduce unnecessary re-renders
- **Scoped styles optimization**: Use scoped styles to limit style recalculation scope and enable style tree-shaking
- **Lazy-load route components**: Split application into small, independently cacheable modules that can be lazy-loaded on demand

## Security

- **Input validation at boundaries**: Validate all component props using Vue's type system and custom validators before processing
- **Sanitize user content**: Always sanitize user-provided content before rendering; avoid `v-html` with untrusted data
- **Event payload validation**: Validate event payloads in parent components before processing emitted data from children
- **Avoid exposing sensitive data**: Do not pass sensitive information through props or store it in component data visible to Vue DevTools
- **Secret management**: Keep API keys and secrets out of component code; use environment variables and server-side proxies

## Anti-Patterns

- **Accessing `this.$parent`**: Never use `this.$parent` to reach parent component state; it creates tight coupling and breaks component reusability
- **Complex template expressions**: Avoid complex JavaScript expressions in templates; extract to computed properties for readability and testability
- **Non-primitive props**: Do not pass complex objects as props without clear interfaces; prefer primitive values or well-defined, validated object shapes
- **Over-sized components**: Avoid components exceeding ~100 LOC; large components are harder to understand, test, and reuse
- **Missing prop validation**: Never leave props unvalidated; always specify type, required status, and defaults to catch integration errors early
