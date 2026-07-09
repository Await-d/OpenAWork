import { z } from 'zod';

export const feishuMessageResponseSchema = z.object({
  code: z.number(),
  msg: z.string().optional(),
  data: z.object({ message_id: z.string().optional() }).optional(),
});

export const feishuTokenResponseSchema = z.object({
  code: z.number(),
  tenant_access_token: z.string(),
  expire: z.number(),
});

export const feishuCardUpdateResponseSchema = z.object({ code: z.number() });

export const feishuUploadImageResponseSchema = z.object({
  code: z.number(),
  msg: z.string().optional(),
  data: z.object({ image_key: z.string().optional() }).optional(),
});

export const feishuUploadFileResponseSchema = z.object({
  code: z.number(),
  msg: z.string().optional(),
  data: z.object({ file_key: z.string().optional() }).optional(),
});

export const feishuChatInfoSchema = z.object({
  code: z.number(),
  msg: z.string().optional(),
  data: z.object({ name: z.string().optional(), chat_type: z.string().optional() }).optional(),
});

export const feishuMessageListSchema = z.object({
  data: z
    .object({
      items: z
        .array(
          z.object({
            message_id: z.string(),
            sender: z.object({ id: z.string().optional(), name: z.string().optional() }).optional(),
            body: z.object({ content: z.string().optional() }).optional(),
            create_time: z.string(),
          }),
        )
        .optional(),
    })
    .optional(),
});

export const feishuGroupListSchema = z.object({
  data: z
    .object({
      items: z
        .array(
          z.object({
            chat_id: z.string(),
            name: z.string(),
            member_count: z.number().optional(),
          }),
        )
        .optional(),
    })
    .optional(),
});

export const feishuMembersSchema = z.object({
  code: z.number(),
  msg: z.string().optional(),
  data: z
    .object({
      items: z.array(z.unknown()).optional(),
      page_token: z.string().optional(),
      has_more: z.boolean().optional(),
    })
    .optional(),
});

export const feishuCodeOnlySchema = z.object({
  code: z.number(),
  msg: z.string().optional(),
});

export const feishuDataEnvelopeSchema = z.object({
  code: z.number(),
  msg: z.string().optional(),
  data: z.unknown().optional(),
});
