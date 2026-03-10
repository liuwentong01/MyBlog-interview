#!/bin/bash
# ============================================================
# Shell 常用命令速查表
# 作者：学习笔记
# 说明：涵盖日常开发中最常用的 Shell 命令，附带示例和注释
# ============================================================


# ============================================================
# 一、文件与目录操作
# ============================================================

# --- ls: 列出目录内容 ---
ls              # 列出当前目录下的文件和文件夹
ls -l           # 长格式显示（权限、大小、时间等）
ls -la          # 包含隐藏文件（以.开头的文件）
ls -lh          # 文件大小用人类可读格式（KB/MB/GB）
ls -lt          # 按修改时间排序（最新的在前）
ls *.ts         # 通配符匹配，只列出 .ts 文件

# --- cd: 切换目录 ---
cd /path/to/dir # 切换到指定目录
cd ..           # 返回上一级目录
cd ~            # 回到用户主目录（等同于 cd $HOME）
cd -            # 回到上一次所在的目录（很实用！）
cd ../..        # 返回上两级

# --- pwd: 显示当前目录的完整路径 ---
pwd

# --- mkdir: 创建目录 ---
mkdir mydir              # 创建单个目录
mkdir -p a/b/c           # 递归创建多层目录（父目录不存在也没关系）

# --- rm: 删除文件或目录 ---
rm file.txt              # 删除文件
rm -r mydir              # 递归删除目录及其内容
rm -rf mydir             # 强制递归删除（不提示确认，慎用！）
rm -i file.txt           # 删除前询问确认（安全起见）

# --- cp: 复制 ---
cp a.txt b.txt           # 复制文件
cp -r dir1 dir2          # 递归复制整个目录
cp -i a.txt b.txt        # 覆盖前询问

# --- mv: 移动 / 重命名 ---
mv old.txt new.txt       # 重命名文件
mv file.txt /other/dir/  # 移动文件到另一个目录

# --- touch: 创建空文件 / 更新文件时间戳 ---
touch newfile.txt        # 文件不存在则创建，存在则更新修改时间

# --- ln: 创建链接 ---
ln -s /real/path link    # 创建软链接（类似快捷方式，最常用）
ln /real/path hardlink   # 创建硬链接


# ============================================================
# 二、文件查看
# ============================================================

# --- cat: 查看文件全部内容 ---
cat file.txt             # 一次性输出整个文件
cat -n file.txt          # 带行号显示

# --- head / tail: 查看文件头部或尾部 ---
head file.txt            # 默认显示前 10 行
head -n 20 file.txt      # 显示前 20 行
tail file.txt            # 默认显示最后 10 行
tail -n 20 file.txt      # 显示最后 20 行
tail -f app.log          # 实时追踪文件新增内容（看日志神器！）

# --- less: 分页查看（支持上下滚动） ---
less largefile.txt       # 按 q 退出，/ 搜索，n 下一个匹配

# --- wc: 统计 ---
wc -l file.txt           # 统计行数
wc -w file.txt           # 统计单词数
wc -c file.txt           # 统计字节数


# ============================================================
# 三、搜索与过滤
# ============================================================

# --- grep: 文本搜索（在文件内容中查找） ---
grep "error" app.log              # 在文件中搜索包含 "error" 的行
grep -r "TODO" ./src              # 递归搜索目录下所有文件
grep -i "error" app.log           # 忽略大小写
grep -n "error" app.log           # 显示匹配的行号
grep -c "error" app.log           # 只显示匹配的行数
grep -v "debug" app.log           # 反向匹配（排除包含 debug 的行）
grep -E "err|warn" app.log        # 正则匹配（匹配 err 或 warn）

# --- rg (ripgrep): 更快的 grep 替代品 ---
rg "TODO" ./src                   # 递归搜索，自动忽略 .gitignore 中的文件
rg -i "error" --type ts           # 只搜索 TypeScript 文件
rg -l "import" ./src              # 只列出包含匹配的文件名

# --- find: 按条件查找文件（找文件本身，不是文件内容） ---
find . -name "*.ts"               # 查找当前目录下所有 .ts 文件
find . -name "*.log" -delete      # 查找并删除所有 .log 文件
find . -type d -name "node_modules"  # 只查找目录
find . -size +100M                # 查找大于 100MB 的文件
find . -mtime -7                  # 查找 7 天内修改过的文件

# --- sort / uniq: 排序与去重 ---
sort file.txt                     # 按字母排序
sort -n file.txt                  # 按数字排序
sort -r file.txt                  # 逆序
sort file.txt | uniq              # 排序后去重
sort file.txt | uniq -c           # 去重并统计出现次数

# --- awk: 文本列处理 ---
awk '{print $1}' file.txt         # 打印每行的第一列（默认空格分隔）
awk -F: '{print $1}' /etc/passwd  # 指定分隔符为冒号
awk '{print NR, $0}' file.txt     # 打印行号和整行内容

# --- sed: 流编辑器（文本替换） ---
sed 's/old/new/' file.txt         # 替换每行第一个匹配
sed 's/old/new/g' file.txt        # 替换所有匹配（g = global）
sed -i '' 's/old/new/g' file.txt  # macOS 上原地修改文件
sed -n '5,10p' file.txt           # 只打印第 5-10 行

# --- xargs: 将标准输入转为命令参数 ---
find . -name "*.log" | xargs rm   # 查找并删除
echo "a b c" | xargs -n1          # 每个参数单独一行


# ============================================================
# 四、管道与重定向
# ============================================================

# 管道 |：将前一个命令的输出作为下一个命令的输入
cat file.txt | grep "error" | wc -l    # 统计 error 出现的行数
ps aux | grep node                      # 查找 node 相关进程

# 输出重定向
echo "hello" > file.txt          # 覆盖写入（文件不存在会创建）
echo "world" >> file.txt         # 追加写入
command > output.txt 2>&1        # stdout 和 stderr 都重定向到文件
command > /dev/null 2>&1         # 丢弃所有输出（静默执行）

# 输入重定向
wc -l < file.txt                 # 从文件读取输入


# ============================================================
# 五、系统与进程管理
# ============================================================

# --- ps: 查看进程 ---
ps aux                    # 查看所有进程
ps aux | grep node        # 查找 node 相关进程

# --- top / htop: 实时监控 ---
top                       # 实时查看 CPU/内存占用（按 q 退出）
# htop                    # 更好看的 top（需安装：brew install htop）

# --- kill: 终止进程 ---
kill 12345                # 发送 SIGTERM 信号，优雅终止
kill -9 12345             # 发送 SIGKILL 信号，强制终止（进程号通过 ps 获取）
killall node              # 终止所有名为 node 的进程

# --- lsof: 查看端口占用 ---
lsof -i :3000             # 查看 3000 端口被哪个进程占用
lsof -i :8080             # 查看 8080 端口

# --- df / du: 磁盘空间 ---
df -h                     # 查看各磁盘分区使用情况
du -sh *                  # 当前目录下每个文件/文件夹的大小
du -sh node_modules       # 查看 node_modules 大小
du -sh . | sort -rh       # 按大小排序

# --- 系统信息 ---
uname -a                  # 操作系统信息
whoami                    # 当前用户名
uptime                    # 系统运行时间
which node                # 查看命令的可执行文件路径
type ls                   # 查看命令类型（别名/内置/外部）


# ============================================================
# 六、网络相关
# ============================================================

# --- curl: HTTP 请求工具（前端开发必备） ---
curl https://api.example.com              # GET 请求
curl -X POST https://api.example.com \
  -H "Content-Type: application/json" \
  -d '{"key":"value"}'                    # POST JSON
curl -o output.html https://example.com   # 下载保存到文件
curl -I https://example.com               # 只看响应头
curl -s https://api.example.com | jq .    # 静默模式 + 用 jq 格式化 JSON

# --- wget: 下载文件 ---
wget https://example.com/file.zip         # 下载文件

# --- ping: 测试网络连通性 ---
ping google.com           # 测试能否连接（Ctrl+C 停止）
ping -c 3 google.com      # 只 ping 3 次

# --- ssh: 远程登录 ---
ssh user@hostname          # 登录远程服务器
ssh -p 2222 user@hostname  # 指定端口

# --- scp: 远程文件复制 ---
scp file.txt user@host:/path/    # 上传文件到服务器
scp user@host:/path/file.txt .   # 从服务器下载文件


# ============================================================
# 七、权限管理
# ============================================================

# --- chmod: 修改文件权限 ---
chmod +x script.sh        # 给文件添加可执行权限
chmod 755 script.sh        # rwxr-xr-x（所有者可读写执行，其他人可读执行）
chmod 644 file.txt         # rw-r--r--（所有者可读写，其他人只读）
# 数字含义：r=4, w=2, x=1，三位分别对应 所有者/组/其他

# --- chown: 修改所有者 ---
chown user:group file.txt  # 修改文件的所有者和组

# --- sudo: 以管理员身份执行 ---
sudo command               # 以 root 权限运行命令
sudo !!                    # 用 sudo 重新执行上一条命令（忘记加 sudo 时超好用）


# ============================================================
# 八、压缩与归档
# ============================================================

# --- tar: 打包/解包 ---
tar -czf archive.tar.gz dir/     # 打包并用 gzip 压缩
tar -xzf archive.tar.gz          # 解压 .tar.gz
tar -xzf archive.tar.gz -C /dest # 解压到指定目录
tar -tf archive.tar.gz           # 查看压缩包内容（不解压）
# c=create, x=extract, z=gzip, f=file, t=list, v=verbose

# --- zip / unzip ---
zip -r archive.zip dir/          # 压缩目录
unzip archive.zip                # 解压
unzip -l archive.zip             # 查看压缩包内容


# ============================================================
# 九、环境变量
# ============================================================

echo $PATH                 # 查看 PATH 环境变量
echo $HOME                 # 用户主目录
env                        # 查看所有环境变量
export MY_VAR="hello"      # 设置环境变量（仅当前 shell 会话有效）
# 要永久生效，写入 ~/.zshrc 或 ~/.bashrc：
# echo 'export MY_VAR="hello"' >> ~/.zshrc && source ~/.zshrc


# ============================================================
# 十、Git 常用命令
# ============================================================

# --- 基本操作 ---
git status                 # 查看工作区状态
git add .                  # 暂存所有修改
git add file.txt           # 暂存指定文件
git commit -m "feat: xxx"  # 提交（建议遵循 Conventional Commits 规范）
git push                   # 推送到远程
git pull                   # 拉取远程更新

# --- 分支操作 ---
git branch                 # 查看本地分支
git branch -a              # 查看所有分支（含远程）
git checkout -b feat/new   # 创建并切换到新分支
git switch feat/new        # 切换分支（Git 2.23+ 推荐用法）
git merge feat/new         # 合并分支到当前分支
git branch -d feat/done    # 删除已合并的分支

# --- 查看历史 ---
git log --oneline          # 简洁查看提交历史
git log --oneline --graph  # 带分支图的提交历史
git diff                   # 查看未暂存的修改
git diff --staged          # 查看已暂存的修改

# --- 撤销与回退 ---
git checkout -- file.txt   # 丢弃工作区的修改
git restore file.txt       # 同上（Git 2.23+ 推荐）
git reset HEAD file.txt    # 取消暂存
git stash                  # 临时保存当前修改
git stash pop              # 恢复最近一次 stash

# --- 远程操作 ---
git remote -v              # 查看远程仓库地址
git fetch                  # 拉取远程信息（不合并）
git clone url              # 克隆仓库


# ============================================================
# 十一、实用技巧与快捷键
# ============================================================

# --- 快捷键（终端中使用） ---
# Ctrl + C    中断当前命令
# Ctrl + Z    挂起当前命令（用 fg 恢复，bg 放到后台）
# Ctrl + D    退出当前 shell
# Ctrl + R    反向搜索历史命令（输入关键词快速找到之前用过的命令）
# Ctrl + A    光标移到行首
# Ctrl + E    光标移到行尾
# Ctrl + W    删除光标前一个单词
# Ctrl + U    删除光标到行首的内容
# Ctrl + L    清屏（等同于 clear）
# Tab         自动补全（文件名、命令名）
# Tab Tab     显示所有可能的补全

# --- 命令连接 ---
cmd1 && cmd2               # cmd1 成功后才执行 cmd2
cmd1 || cmd2               # cmd1 失败后才执行 cmd2
cmd1 ; cmd2                # 无论 cmd1 是否成功都执行 cmd2

# --- 后台执行 ---
command &                  # 在后台运行命令
nohup command &            # 后台运行，且终端关闭后继续执行
jobs                       # 查看后台任务
fg %1                      # 将后台任务 1 调到前台

# --- 历史命令 ---
history                    # 查看命令历史
!!                         # 执行上一条命令
!grep                      # 执行最近一条以 grep 开头的命令
!$                         # 上一条命令的最后一个参数

# --- alias: 命令别名 ---
alias ll='ls -la'          # 设置别名
alias gs='git status'
alias gp='git push'
# 写入 ~/.zshrc 可永久生效

# --- 实用组合示例 ---
# 查看当前目录下最大的 10 个文件/文件夹
du -sh * | sort -rh | head -10

# 批量重命名 .js 为 .ts
# for f in *.js; do mv "$f" "${f%.js}.ts"; done

# 查找并替换所有文件中的字符串
# rg -l "oldText" --type ts | xargs sed -i '' 's/oldText/newText/g'

# 监听文件变化（macOS 需安装 fswatch）
# fswatch -o ./src | xargs -n1 -I{} echo "文件发生变化"
