/**
 * greeting-tool 插件示例
 *
 * 这是一个最简单的 OpenClaw 工具插件示例。
 * 插件放在 extensions/ 目录下，系统自动扫描和加载。
 *
 * 插件导出格式：
 *   module.exports = {
 *     name: '插件名称',
 *     description: '插件描述',
 *     tools: [工具定义数组]
 *   }
 *
 * 每个工具定义需要包含：
 *   - name: 工具名称（唯一标识）
 *   - description: 工具描述（LLM 用来理解工具用途）
 *   - parameters: JSON Schema 格式的参数定义
 *   - execute: 异步执行函数
 */

module.exports = {
  name: 'greeting-tool',
  description: '一个打招呼的示例插件，展示 OpenClaw 的插件扩展机制',

  tools: [
    {
      name: 'greeting',
      description: '向指定的人打招呼，生成个性化问候语',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: '要打招呼的人的名字',
          },
        },
        required: ['name'],
      },
      execute: async (args) => {
        const greetings = [
          `你好 ${args.name}！很高兴见到你！🎉`,
          `嗨 ${args.name}！今天过得怎么样？😊`,
          `${args.name}，欢迎来到 Mini-OpenClaw 的世界！🦞`,
          `哈喽 ${args.name}！我是你的 AI 助手，有什么可以帮你的吗？🤖`,
        ];
        const idx = Math.floor(Math.random() * greetings.length);
        return greetings[idx];
      },
    },
  ],
};
