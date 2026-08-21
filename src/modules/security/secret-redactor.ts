export interface RedactionResult {
  text: string;
  count: number;
  categories: string[];
}

interface RedactionState {
  next: number;
  count: number;
  categories: Set<string>;
}

function replacement(state: RedactionState, category: string) {
  state.count += 1;
  state.categories.add(category);
  return `[SECRET_${state.next++}]`;
}

export function redactSensitiveText(input: string): RedactionResult {
  const state: RedactionState = { next: 1, count: 0, categories: new Set() };
  let text = input;

  text = text.replace(
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
    () => replacement(state, "private-key"),
  );

  text = text.replace(
    /\b(Authorization\s*:\s*Bearer\s+)([^\s"']+)/gi,
    (_, prefix: string) => `${prefix}${replacement(state, "bearer-token")}`,
  );

  text = text.replace(
    /\b(Bearer\s+)([A-Za-z0-9._~+/=-]{16,})/g,
    (_, prefix: string) => `${prefix}${replacement(state, "bearer-token")}`,
  );

  text = text.replace(
    /\b((?:(?:[a-z][a-z0-9]*)_)*(?:api[_-]?key|secret(?:[_-]?(?:key|access[_-]?key))?|access[_-]?key|password|passwd|token|client[_-]?secret)\s*[:=]\s*["']?)([^\s"';,}]{6,})(["']?)/gi,
    (_, prefix: string, _value: string, suffix: string) =>
      `${prefix}${replacement(state, "credential")}${suffix}`,
  );

  text = text.replace(
    /\b((?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|mariadb):\/\/[^:\s/@]+:)([^@\s/]+)(@)/gi,
    (_, prefix: string, _password: string, suffix: string) =>
      `${prefix}${replacement(state, "connection-string")}${suffix}`,
  );

  text = text.replace(
    /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
    () => replacement(state, "jwt"),
  );

  text = text.replace(
    /\b(?:AIza[0-9A-Za-z_-]{30,}|sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{30,})\b/g,
    () => replacement(state, "api-key"),
  );

  return {
    text,
    count: state.count,
    categories: [...state.categories],
  };
}

export function redactObjectText<T extends { content: string }>(items: T[]) {
  let count = 0;
  const redacted = items.map((item) => {
    const result = redactSensitiveText(item.content);
    count += result.count;
    return { ...item, content: result.text };
  });
  return { items: redacted, count };
}
