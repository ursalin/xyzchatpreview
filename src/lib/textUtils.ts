/**
 * 移除文本中括号内的内容（包括中英文括号）
 * 用于TTS朗读时跳过括号内的描述性内容
 */
export function removeParenthesesContent(text: string): string {
  // 移除中文括号内的内容：（...）
  let result = text.replace(/（[^）]*）/g, '');
  // 移除英文括号内的内容：(...)
  result = result.replace(/\([^)]*\)/g, '');
  // 移除中文方括号内的内容：【...】
  result = result.replace(/【[^】]*】/g, '');
  // 移除英文方括号内的内容：[...]
  result = result.replace(/\[[^\]]*\]/g, '');
  // 清理多余的空格
  result = result.replace(/\s+/g, ' ').trim();
  return result;
}
