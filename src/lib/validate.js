export function validate(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);

    if (!result.success) {
      const fieldErrors = {};

      for (const issue of result.error.issues) {
        const field = issue.path.length > 0 ? issue.path.join(".") : "_";
        fieldErrors[field] ??= [];
        fieldErrors[field].push(issue.message);
      }

      return res.status(422).json({
        error: {
          message: "Validation failed",
          details: { fieldErrors },
        },
      });
    }

    req.body = result.data;
    return next();
  };
}
