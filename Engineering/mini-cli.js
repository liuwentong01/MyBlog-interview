/**
 * Mini CLI 脚手架实现
 *
 * ═══════════════════════════════════════════════════════
 *  CLI 脚手架的核心原理
 * ═══════════════════════════════════════════════════════
 *
 * 类 create-vite / create-react-app 的工作流程：
 *
 *   1. 解析命令行参数（commander / yargs）
 *      npx create-app my-project --template react
 *
 *   2. 交互式问答（inquirer / prompts）
 *      选择框架？选择语言？是否需要 TypeScript？
 *
 *   3. 模板处理
 *      下载模板（git clone / npm 包）
 *      或内置模板 + 变量替换（EJS / Handlebars）
 *
 *   4. 生成项目
 *      创建目录 → 写入文件 → 安装依赖 → 初始化 git
 *
 *   5. 输出提示
 *      cd my-project && npm run dev
 *
 * ═══════════════════════════════════════════════════════
 *  本文件实现
 * ═══════════════════════════════════════════════════════
 *
 *  1. 命令行参数解析器（mini commander）
 *  2. 交互式问答（mini prompts，模拟 inquirer）
 *  3. 模板引擎（变量替换 + 条件渲染）
 *  4. 项目生成器（目录创建 + 文件写入）
 *  5. 完整演示：模拟创建一个前端项目
 *
 * 运行方式：node Engineering/mini-cli.js
 */

const path = require("path");

// ═══════════════════════════════════════════════════════════════════════════
// 一、命令行参数解析器
// ═══════════════════════════════════════════════════════════════════════════
//
// 解析 process.argv 中的参数
// 支持：
//   位置参数：create-app my-project → args._[0] = "my-project"
//   选项参数：--template react → args.template = "react"
//   布尔开关：--typescript → args.typescript = true
//   短选项：  -t react → args.t = "react"
//
// 真实工具用 commander / yargs，这里手写核心逻辑

class Command {
  constructor(name) {
    this.name = name;
    this._description = "";
    this._options = [];
    this._action = null;
  }

  description(desc) {
    this._description = desc;
    return this;
  }

  option(flags, description, defaultValue) {
    // flags: "-t, --template <value>"
    const match = flags.match(/-(\w),?\s+--(\w[\w-]*)\s*(<.*>)?/);
    if (match) {
      this._options.push({
        short: match[1],
        long: match[2],
        hasValue: !!match[3],
        description,
        defaultValue,
      });
    }
    return this;
  }

  action(fn) {
    this._action = fn;
    return this;
  }

  /**
   * 解析命令行参数
   * @param {string[]} argv - 如 ["node", "cli.js", "my-project", "--template", "react"]
   */
  parse(argv) {
    const args = { _: [] };

    // 设置默认值
    this._options.forEach((opt) => {
      if (opt.defaultValue !== undefined) {
        args[opt.long] = opt.defaultValue;
      }
    });

    // 跳过 "node" 和脚本名
    const tokens = argv.slice(2);

    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];

      if (token.startsWith("--")) {
        // 长选项 --template react 或 --typescript
        const key = token.slice(2);
        const opt = this._options.find((o) => o.long === key);
        if (opt && opt.hasValue && i + 1 < tokens.length) {
          args[key] = tokens[++i];
        } else {
          args[key] = true;
        }
      } else if (token.startsWith("-")) {
        // 短选项 -t react
        const key = token.slice(1);
        const opt = this._options.find((o) => o.short === key);
        if (opt) {
          if (opt.hasValue && i + 1 < tokens.length) {
            args[opt.long] = tokens[++i];
          } else {
            args[opt.long] = true;
          }
        }
      } else {
        // 位置参数
        args._.push(token);
      }
    }

    if (this._action) {
      this._action(args);
    }

    return args;
  }

  help() {
    let text = `\n  ${this.name} - ${this._description}\n\n`;
    text += "  Options:\n";
    this._options.forEach((opt) => {
      const flags = `  -${opt.short}, --${opt.long}${opt.hasValue ? " <value>" : ""}`;
      text += `${flags.padEnd(30)} ${opt.description}\n`;
    });
    return text;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 二、交互式问答（模拟 inquirer）
// ═══════════════════════════════════════════════════════════════════════════
//
// 真实 CLI 中用 inquirer 或 @clack/prompts 做交互
// 这里模拟问答过程（预设答案），展示数据结构和流程

class Prompts {
  /**
   * 模拟交互式问答
   * @param {Array} questions - 问题列表
   * @param {Object} mockAnswers - 模拟的用户回答（真实场景从 stdin 读取）
   */
  static async ask(questions, mockAnswers = {}) {
    const answers = {};

    for (const q of questions) {
      // 如果有 when 条件，检查是否应该跳过
      if (q.when && !q.when(answers)) {
        continue;
      }

      const answer = mockAnswers[q.name] !== undefined
        ? mockAnswers[q.name]
        : q.default;

      // 类型检查
      if (q.type === "list" || q.type === "select") {
        const choice = q.choices.find((c) =>
          typeof c === "string" ? c === answer : c.value === answer
        );
        answers[q.name] = typeof choice === "string" ? choice : choice?.value || answer;
        console.log(`  ? ${q.message} › ${answers[q.name]}`);
      } else if (q.type === "confirm") {
        answers[q.name] = answer === true || answer === "yes";
        console.log(`  ? ${q.message} › ${answers[q.name] ? "Yes" : "No"}`);
      } else {
        answers[q.name] = answer;
        console.log(`  ? ${q.message} › ${answers[q.name]}`);
      }

      // validate
      if (q.validate) {
        const valid = q.validate(answers[q.name]);
        if (valid !== true) {
          console.log(`    ✗ ${valid}`);
        }
      }
    }

    return answers;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 三、模板引擎
// ═══════════════════════════════════════════════════════════════════════════
//
// 类似 EJS / Handlebars 的简化版
// 支持：
//   {{name}}           → 变量替换
//   {{#if condition}}  → 条件渲染
//   {{#each items}}    → 循环渲染

class TemplateEngine {
  /**
   * 渲染模板字符串
   * @param {string} template - 模板
   * @param {Object} data - 数据
   */
  static render(template, data) {
    let result = template;

    // 1. 处理条件 {{#if key}} ... {{/if}}
    result = result.replace(
      /\{\{#if\s+(\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g,
      (_, key, content) => {
        return data[key] ? content : "";
      }
    );

    // 2. 处理 else: {{#if key}} ... {{else}} ... {{/if}}
    result = result.replace(
      /\{\{#if\s+(\w+)\}\}([\s\S]*?)\{\{else\}\}([\s\S]*?)\{\{\/if\}\}/g,
      (_, key, ifContent, elseContent) => {
        return data[key] ? ifContent : elseContent;
      }
    );

    // 3. 处理循环 {{#each key}} {{this}} {{/each}}
    result = result.replace(
      /\{\{#each\s+(\w+)\}\}([\s\S]*?)\{\{\/each\}\}/g,
      (_, key, content) => {
        const arr = data[key] || [];
        return arr.map((item) => content.replace(/\{\{this\}\}/g, item)).join("");
      }
    );

    // 4. 变量替换 {{key}}
    result = result.replace(/\{\{(\w+)\}\}/g, (_, key) => {
      return data[key] !== undefined ? data[key] : "";
    });

    return result;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 四、项目生成器
// ═══════════════════════════════════════════════════════════════════════════
//
// 根据模板和用户选择，生成项目文件结构

class ProjectGenerator {
  constructor(projectName, options) {
    this.projectName = projectName;
    this.options = options;
    this.files = new Map(); // 虚拟文件系统（不真正写磁盘）
  }

  /**
   * 根据模板生成文件列表
   */
  generate() {
    const { framework, typescript, cssPreprocessor } = this.options;

    // package.json
    this.files.set("package.json", TemplateEngine.render(TEMPLATES.packageJson, {
      name: this.projectName,
      framework,
      typescript,
      cssPreprocessor: cssPreprocessor !== "none",
    }));

    // 入口文件
    const ext = typescript ? "tsx" : "jsx";
    if (framework === "react") {
      this.files.set(`src/App.${ext}`, TemplateEngine.render(TEMPLATES.reactApp, {
        name: this.projectName,
        typescript,
      }));
      this.files.set(`src/main.${ext}`, TEMPLATES.reactMain);
    } else if (framework === "vue") {
      this.files.set("src/App.vue", TemplateEngine.render(TEMPLATES.vueApp, {
        name: this.projectName,
        typescript,
      }));
    }

    // TypeScript 配置
    if (typescript) {
      this.files.set("tsconfig.json", TEMPLATES.tsconfig);
    }

    // index.html
    this.files.set("index.html", TemplateEngine.render(TEMPLATES.indexHtml, {
      name: this.projectName,
      framework,
    }));

    // .gitignore
    this.files.set(".gitignore", "node_modules\ndist\n.env.local\n");

    return this;
  }

  /**
   * 打印生成的文件树
   */
  printFileTree() {
    console.log(`\n  ${this.projectName}/`);
    const sortedFiles = [...this.files.keys()].sort();
    sortedFiles.forEach((filePath, i) => {
      const parts = filePath.split("/");
      const indent = "  ".repeat(parts.length);
      const isLast = i === sortedFiles.length - 1;
      const prefix = isLast ? "└── " : "├── ";
      console.log(`  ${indent}${prefix}${parts[parts.length - 1]}`);
    });
  }

  /**
   * 打印某个文件的内容
   */
  printFile(filePath) {
    const content = this.files.get(filePath);
    if (content) {
      content.split("\n").forEach((line) => console.log("    " + line));
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 五、模板定义
// ═══════════════════════════════════════════════════════════════════════════

const TEMPLATES = {
  packageJson: `{
  "name": "{{name}}",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "{{framework}}": "latest"
  },
  "devDependencies": {
    "vite": "^5.0.0"{{#if typescript}},
    "typescript": "^5.0.0"{{/if}}
  }
}`,

  reactApp: `{{#if typescript}}interface AppProps {}

{{/if}}function App({{#if typescript}}props: AppProps{{/if}}) {
  return (
    <div>
      <h1>{{name}}</h1>
      <p>Welcome to your new {{#if typescript}}TypeScript + {{/if}}React app!</p>
    </div>
  );
}

export default App;`,

  reactMain: `import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);`,

  vueApp: `<template>
  <div>
    <h1>{{name}}</h1>
    <p>Welcome to your new {{#if typescript}}TypeScript + {{/if}}Vue app!</p>
  </div>
</template>

<script{{#if typescript}} lang="ts"{{/if}}>
export default {
  name: 'App',
};
</script>`,

  tsconfig: `{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "jsx": "react-jsx",
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src"]
}`,

  indexHtml: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>{{name}}</title>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/src/main.jsx"></script>
</body>
</html>`,
};

// ═══════════════════════════════════════════════════════════════════════════
// 六、测试
// ═══════════════════════════════════════════════════════════════════════════

console.log("=== Mini CLI 脚手架演示 ===\n");

// ── 测试 1：命令行参数解析 ──

console.log("【测试 1】命令行参数解析\n");

const program = new Command("create-app")
  .description("Create a new frontend project")
  .option("-t, --template <value>", "Project template", "react")
  .option("-T, --typescript", "Use TypeScript", false);

// 模拟：create-app my-project --template react --typescript
const argv1 = ["node", "create-app", "my-project", "--template", "react", "--typescript"];
const parsed1 = program.parse(argv1);
console.log("  命令: create-app my-project --template react --typescript");
console.log("  解析结果:", JSON.stringify(parsed1));

// 短选项
const argv2 = ["node", "create-app", "demo", "-t", "vue"];
const parsed2 = program.parse(argv2);
console.log("\n  命令: create-app demo -t vue");
console.log("  解析结果:", JSON.stringify(parsed2));

console.log("\n  帮助信息:");
console.log(program.help());

// ── 测试 2：交互式问答 ──

console.log("【测试 2】交互式问答（模拟用户选择）\n");

const questions = [
  {
    name: "projectName",
    type: "input",
    message: "Project name:",
    default: "my-app",
    validate: (val) => val.length > 0 || "Name cannot be empty",
  },
  {
    name: "framework",
    type: "list",
    message: "Select framework:",
    choices: [
      { value: "react", name: "React" },
      { value: "vue", name: "Vue" },
      { value: "vanilla", name: "Vanilla JS" },
    ],
    default: "react",
  },
  {
    name: "typescript",
    type: "confirm",
    message: "Add TypeScript?",
    default: true,
  },
  {
    name: "cssPreprocessor",
    type: "list",
    message: "CSS preprocessor:",
    choices: ["none", "sass", "less"],
    default: "none",
    // 条件显示：只有选了 react 或 vue 才问
    when: (answers) => answers.framework !== "vanilla",
  },
];

// 模拟用户回答
const mockAnswers = {
  projectName: "awesome-app",
  framework: "react",
  typescript: true,
  cssPreprocessor: "sass",
};

(async () => {
  const answers = await Prompts.ask(questions, mockAnswers);
  console.log("\n  收集到的配置:", JSON.stringify(answers, null, 2));

  // ── 测试 3：模板引擎 ──

  console.log("\n\n【测试 3】模板引擎\n");

  const template = `Hello {{name}}!
{{#if typescript}}import type { FC } from 'react';{{/if}}
{{#if cssPreprocessor}}import './styles.scss';{{/if}}`;

  console.log("  模板:");
  template.split("\n").forEach((l) => console.log("    " + l));

  const rendered = TemplateEngine.render(template, {
    name: "World",
    typescript: true,
    cssPreprocessor: true,
  });
  console.log("\n  渲染结果:");
  rendered.split("\n").forEach((l) => console.log("    " + l));

  // ── 测试 4：完整项目生成 ──

  console.log("\n\n【测试 4】完整项目生成\n");

  const generator = new ProjectGenerator("awesome-app", answers);
  generator.generate();
  generator.printFileTree();

  console.log("\n  生成的 package.json:");
  generator.printFile("package.json");

  console.log("\n  生成的 src/App.tsx:");
  generator.printFile("src/App.tsx");

  // ── 测试 5：模拟完整流程 ──

  console.log("\n\n【测试 5】完整 CLI 流程模拟\n");

  console.log("  $ npx create-awesome-app my-project\n");
  console.log("  Scaffolding project in ./my-project ...\n");
  console.log(`  Done. Now run:\n`);
  console.log(`    cd my-project`);
  console.log(`    npm install`);
  console.log(`    npm run dev`);

  console.log("\n\n=== 面试要点 ===");
  console.log("1. CLI 工具 = 参数解析(commander) + 交互问答(inquirer) + 模板渲染 + 文件生成");
  console.log("2. 参数解析：遍历 process.argv，区分 --long/-s/位置参数");
  console.log("3. 交互问答：input/list/confirm 三种基本类型，支持 when 条件、validate 校验");
  console.log("4. 模板引擎：变量替换 {{key}} + 条件 {{#if}} + 循环 {{#each}}");
  console.log("5. 项目生成：创建目录 → 写入文件 → execSync('npm install') → git init");
  console.log("6. 真实脚手架还支持：远程模板下载(degit/giget)、插件系统、版本检查");
  console.log("7. create-vite 的核心就是内置模板 + 变量替换，非常轻量");
})();
