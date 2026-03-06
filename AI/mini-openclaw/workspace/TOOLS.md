# 工具使用说明

## 内置工具

- `get_current_time` - 获取当前时间，无需参数
- `list_files` - 列出目录文件，参数 path 可选
- `read_file` - 读取文件内容，参数 path 必填
- `run_shell` - 执行 Shell 命令，参数 command 必填

## 注意事项

- Shell 命令有 10 秒超时限制
- 读取文件默认最多 50 行
- 不要执行 rm -rf 等危险命令
