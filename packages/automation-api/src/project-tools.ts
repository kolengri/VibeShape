import { documentNameSchema } from "@vibeshape/domain"
import { documentIdSchema, revisionSchema } from "@vibeshape/domain/identifiers"
import { z } from "zod"

const expectedProject = {
  expectedProjectId: documentIdSchema,
  expectedRevision: revisionSchema,
}
export const projectToolInputs = {
  list_projects: z
    .object({
      cursor: documentIdSchema.optional(),
      limit: z.number().int().min(1).max(100).default(50),
    })
    .strict(),
  create_project: z.object({ ...expectedProject, name: documentNameSchema }).strict(),
  open_project: z.object({ ...expectedProject, projectId: documentIdSchema }).strict(),
} as const
export const projectToolNames = ["list_projects", "create_project", "open_project"] as const
export const projectOperations = [
  z
    .object({ tool: z.literal("list_projects"), arguments: projectToolInputs.list_projects })
    .strict(),
  z
    .object({ tool: z.literal("create_project"), arguments: projectToolInputs.create_project })
    .strict(),
  z.object({ tool: z.literal("open_project"), arguments: projectToolInputs.open_project }).strict(),
] as const
export const projectViewSchema = z
  .object({ projectId: documentIdSchema, name: documentNameSchema, revision: revisionSchema })
  .strict()
export const projectListSchema = z
  .object({
    activeProjectId: documentIdSchema,
    projects: z.array(projectViewSchema.extend({ updatedAt: z.iso.datetime() })).max(100),
    nextCursor: documentIdSchema.nullable(),
  })
  .strict()
