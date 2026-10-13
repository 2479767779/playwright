// aiConfig.js
// AI 接口共用配置（种子模板）：测试脚本和各评论脚本都从这里读取。
// ⚠️ 这是提交到 git 的模板，请保持 endpoint/apiKey/model 为空！
//    运行时请在程序「AI 接口配置」页填写：桌面版写到用户数据目录；开发模式(bat)会写回本文件。
module.exports = {
  // 接口格式：'chat' => /v1/chat/completions ；'responses' => /responses ；'messages' => /v1/messages（Claude）
  apiType: 'messages',
  // 完整接口地址（运行时在「AI 接口配置」页填写，此处保持空）
  endpoint: '',
  // 接口密钥（运行时在「AI 接口配置」页填写，此处保持空，勿提交真实密钥）
  apiKey: '',
  // 模型名（运行时在「AI 接口配置」页填写，此处保持空）
  model: '',
  // 单次生成最大输出 token（「AI 接口配置」页可调）
  maxTokens: 4096,
  // 采样温度（「AI 接口配置」页可调；Anthropic Messages 协议下部分模型会忽略）
  temperature: 0.7,
  // 单次请求超时（秒）
  timeout: 60,
};
