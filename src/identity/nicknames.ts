/**
 * Random nickname suggestions: a positive, cheerful adjective plus the name of an animal, an insect or a flower
 * (owner decision 2026-11-08). A suggestion only fills the edit box; the member saves it explicitly.
 */
export const NICKNAME_ADJECTIVES: readonly string[] = [
  '開朗', '陽光', '樂觀', '勇敢', '積極', '熱情', '溫暖', '閃亮', '自信', '活力', '堅強', '快樂', '幸運', '認真', '元氣',
  '善良', '明亮', '微笑', '靈巧', '灑脫', '澄澈', '奮進', '飛揚', '溫柔', '大方', '勤奮', '專注', '從容', '豁達', '充實',
  '清新', '機靈', '勇往直前', '笑口常開', '朝氣', '希望', '堅定', '真誠', '安心', '耀眼',
];

export const NICKNAME_ANIMALS: readonly string[] = [
  '海豚', '小鹿', '柴犬', '貓頭鷹', '企鵝', '水獺', '鯨魚', '小熊貓', '長頸鹿', '無尾熊', '白鷺', '山羌', '松鼠', '兔子',
  '燕子', '藍鵲', '黑熊', '海龜', '獅子', '大象', '貓咪', '麻雀', '海豹', '狐狸', '駱馬', '刺蝟', '天鵝', '鸚鵡', '烏龜', '梅花鹿',
];

export const NICKNAME_INSECTS: readonly string[] = ['蜜蜂', '瓢蟲', '蝴蝶', '螢火蟲', '蜻蜓', '獨角仙', '螳螂', '蟋蟀', '鳳蝶', '金龜子'];

export const NICKNAME_FLOWERS: readonly string[] = [
  '向日葵', '櫻花', '蒲公英', '鬱金香', '茉莉', '薰衣草', '波斯菊', '山茶花', '桔梗', '百合', '玫瑰', '繡球花', '油菜花', '雛菊', '木棉花', '桂花',
];

const NAMES: readonly string[] = [...NICKNAME_ANIMALS, ...NICKNAME_INSECTS, ...NICKNAME_FLOWERS];

/** A random nickname, different from `current` when possible. */
export function randomNickname(current: string | null, random: () => number = Math.random): string {
  const pick = (list: readonly string[]): string => list[Math.floor(random() * list.length)] ?? list[0] ?? '';
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = `${pick(NICKNAME_ADJECTIVES)}${pick(NAMES)}`;
    if (candidate !== current) return candidate;
  }
  return `${pick(NICKNAME_ADJECTIVES)}${pick(NAMES)}`;
}
