import { z } from "zod";

const optionalDate = z.preprocess(
  (value) => (value === "" || value === null ? undefined : value),
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
);

export const getAdminReportsSchema = z.object({
  query: z
    .object({
      fromDate: optionalDate,
      toDate: optionalDate,
    })
    .refine(
      ({ fromDate, toDate }) => !fromDate || !toDate || fromDate <= toDate,
      {
        message: "From date must be before or equal to to date",
        path: ["toDate"],
      },
    ),
});
