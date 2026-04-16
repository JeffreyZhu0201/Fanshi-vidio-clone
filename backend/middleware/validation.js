import { AppError } from './errorHandler.js';

const validateRequest = (schemas) => {
  return (request, _response, next) => {
    try {
      for (const [target, schema] of Object.entries(schemas)) {
        if (!schema) {
          continue;
        }

        const { value, error } = schema.validate(request[target], {
          abortEarly: false,
          convert: true,
          stripUnknown: true
        });

        if (error) {
          throw new AppError('Request validation failed', 400, {
            target,
            errors: error.details.map((detail) => detail.message)
          });
        }

        request[target] = value;
      }

      next();
    } catch (error) {
      next(error);
    }
  };
};

export { validateRequest };
