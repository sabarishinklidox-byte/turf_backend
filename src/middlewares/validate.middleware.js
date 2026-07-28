export const validate = (schema) => (request, _response, next) => {
  const validated = schema.parse({
    body: request.body,
    params: request.params,
    query: request.query,
  });

  if (validated.body !== undefined) request.body = validated.body;
  if (validated.params !== undefined) request.params = validated.params;
  if (validated.query !== undefined) {
    Object.defineProperty(request, "query", {
      value: validated.query,
      configurable: true,
      enumerable: true,
    });
  }
  next();
};
