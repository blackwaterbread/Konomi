import { getDB } from "./db";

const DEFAULT_BASE_GROUPS = [
  "인원",
  "등급/검열 수준",
  "작화/스타일",
  "구도",
  "장소",
  "기타 효과",
  "퀄리티 태그",
];

const DEFAULT_CHAR_GROUPS = [
  "성별 혹은 인외 구분",
  "특정 캐릭터",
  "나이",
  "머리/안구 색",
  "의상",
  "자세",
  "행위",
  "신체 부위",
  "얼굴 관련",
  "기타 효과",
];

async function seedDefaults() {
  const db = getDB();
  const count = await db.promptGroup.count();
  if (count > 0) return;
  await db.promptGroup.createMany({
    data: [
      ...DEFAULT_BASE_GROUPS.map((name, i) => ({
        name,
        type: "base",
        order: i,
      })),
      ...DEFAULT_CHAR_GROUPS.map((name, i) => ({
        name,
        type: "character",
        order: i,
      })),
    ],
  });
}

export async function resetGroups(): Promise<void> {
  const db = getDB();
  await db.promptGroup.deleteMany();
  await db.promptGroup.createMany({
    data: [
      ...DEFAULT_BASE_GROUPS.map((name, i) => ({
        name,
        type: "base",
        order: i,
      })),
      ...DEFAULT_CHAR_GROUPS.map((name, i) => ({
        name,
        type: "character",
        order: i,
      })),
    ],
  });
}

export type PromptGroupWithTokens = {
  id: number;
  name: string;
  type: string;
  order: number;
  tokens: { id: number; label: string; order: number }[];
};

export async function listGroups(): Promise<PromptGroupWithTokens[]> {
  await seedDefaults();
  const db = getDB();
  return db.promptGroup.findMany({
    orderBy: { order: "asc" },
    include: { tokens: { orderBy: { order: "asc" } } },
  });
}

export async function createGroup(
  name: string,
  type: string,
): Promise<PromptGroupWithTokens> {
  const db = getDB();
  const last = await db.promptGroup.findFirst({
    where: { type },
    orderBy: { order: "desc" },
  });
  return db.promptGroup.create({
    data: { name, type, order: (last?.order ?? -1) + 1 },
    include: { tokens: true },
  });
}

export async function deleteGroup(id: number): Promise<void> {
  await getDB().promptGroup.delete({ where: { id } });
}

export async function renameGroup(id: number, name: string): Promise<void> {
  await getDB().promptGroup.update({ where: { id }, data: { name } });
}

export async function reorderGroups(ids: number[]): Promise<void> {
  const db = getDB();
  await db.$transaction(
    ids.map((id, i) =>
      db.promptGroup.update({ where: { id }, data: { order: i } }),
    ),
  );
}

export async function createToken(
  groupId: number,
  label: string,
): Promise<{ id: number; label: string; order: number; groupId: number }> {
  const db = getDB();
  const last = await db.promptToken.findFirst({
    where: { groupId },
    orderBy: { order: "desc" },
  });
  return db.promptToken.create({
    data: { label, groupId, order: (last?.order ?? -1) + 1 },
  });
}

export async function deleteToken(id: number): Promise<void> {
  await getDB().promptToken.delete({ where: { id } });
}

export async function reorderTokens(
  _groupId: number,
  ids: number[],
): Promise<void> {
  const db = getDB();
  await db.$transaction(
    ids.map((id, i) =>
      db.promptToken.update({ where: { id }, data: { order: i } }),
    ),
  );
}
