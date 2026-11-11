/*!
 * 小逻辑 KidLang v0.2 —— 中文编程语言解释器
 *
 * 源码 → 词法 → 语法(AST) → 生成器解释器（可单步暂停）
 *
 * v0.2 特性
 *  · 「定义」+ 可选类型：整型 / 浮点型 / 布尔型 / 字符型 / 字符串 / 数组 / 指针 / 文件
 *  · 四则运算仿 Python：+ - * / // % **
 *  · 逻辑运算：非 / 与 / 或
 *  · 分支：如果 / 或者如果 / 否则
 *  · 循环：当（while）/ 做…结束当（do-while）/ 对于…从…到（for）
 *  · 「定义 函数」「返回」，支持递归与词法作用域
 *  · 数组：字面量、下标读写、长度
 *  · 指针：& 取地址、* 解引用、指向 写法
 *  · 文件：打开文件 / 写 / 读 / 关闭（虚拟文件系统，浏览器内可跑）
 *  · 输入 / 输出
 *
 * 设计原则（v0.1 遗产，未变）
 *  1. 不依赖缩进、不依赖换行 —— 语句边界由关键字决定
 *  2. 没有 = == : {} ; —— 赋值用「定义 / 把…改成」，比较用「等于」
 *  3. 中文标点自动归一 —— 输入法造成的错误全部吞掉
 *  4. generator 解释器，每步 yield 快照，天然支持单步与轨迹判分
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.KidLang = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MAX_STEPS = 60000;
  var MAX_DEPTH = 120;

  /* ======================= 错误 ======================= */

  function LangError(message, line, hint) {
    this.name = 'LangError';
    this.message = message;
    this.line = line || 1;
    this.hint = hint || '';
  }
  LangError.prototype = Object.create(Error.prototype);
  LangError.prototype.constructor = LangError;

  function err(msg, line, hint) { throw new LangError(msg, line, hint); }

  /* ======================= 词法 ======================= */

  var TYPES = ['整型', '浮点型', '布尔型', '字符型', '字符串', '数组', '指针', '文件', '函数'];
  var TYPE_SCALAR = { '整型': 1, '浮点型': 1, '布尔型': 1, '字符型': 1, '字符串': 1 };

  var HARD = [
    '大于等于', '小于等于', '不等于', '或者如果', '打开文件', '结束当',
    '定义', '把', '给', '说', '输出', '输入', '如果', '否则', '当', '做',
    '对于', '结束', '停', '返回', '参数', '指向',
    '非', '与', '或', '真', '假',
    '大于', '小于', '等于',
    '加上', '减去', '乘以', '除以', '整除', '取余', '乘方',
    '随机', '绝对值', '长度', '余数', '地址', '取地址',
    '整型', '浮点型', '布尔型', '字符型', '字符串', '数组', '指针', '文件', '函数',
    '写', '读', '关闭', '追加'
  ].sort(function (a, b) { return b.length - a.length; });

  // 软关键字：按位置识别，可出现在变量名中（时间、从来、为什么 都能当变量名）
  var SOFT = ['是', '时', '次', '从', '到', '步长', '为'];

  var FULLWIDTH = {
    '（': '(', '）': ')', '［': '[', '］': ']',
    '＋': '+', '－': '-', '＊': '*', '／': '/', '×': '*', '÷': '/', '％': '%',
    '，': ',', '、': ',',
    '：': ' ', '；': ' ', '　': ' ', '\t': ' '
  };

  var RE_ID_START = /[\u4e00-\u9fa5A-Za-z_]/;
  var RE_ID_BODY = /[\u4e00-\u9fa5A-Za-z0-9_]/;

  function tokenize(src) {
    var code = src;
    var tokens = [];
    var i = 0, line = 1;

    while (i < code.length) {
      var raw = code[i];

      if (raw === '\n') { line++; i++; continue; }
      if (raw === '\r') { i++; continue; }
      if (raw === '#') { while (i < code.length && code[i] !== '\n') i++; continue; }

      // 双引号字符串
      if (raw === '"' || raw === '“' || raw === '「') {
        var closeS = raw === '「' ? '」' : (raw === '“' ? '”' : '"');
        var j = i + 1, s = '';
        while (j < code.length && code[j] !== closeS && code[j] !== '\n') { s += code[j]; j++; }
        if (code[j] !== closeS) err('这句话的引号忘关啦', line, '文字要用一对双引号包起来，比如 "你好"');
        tokens.push({ t: 'str', v: s, line: line });
        i = j + 1; continue;
      }

      // 单引号字符
      if (raw === "'" || raw === '‘') {
        var closeC = raw === '‘' ? '’' : "'";
        var k = i + 1, c = '';
        while (k < code.length && code[k] !== closeC && code[k] !== '\n') { c += code[k]; k++; }
        if (code[k] !== closeC) err('这个字符的引号忘关啦', line, "字符型用单引号，比如 'A'");
        if (c.length !== 1) err('字符型只能放一个字符，你放了 ' + c.length + ' 个', line, '想要一串文字请用双引号');
        tokens.push({ t: 'chr', v: c, line: line });
        i = k + 1; continue;
      }

      // 数字
      if (raw >= '0' && raw <= '9') {
        var m = i, num = '';
        while (m < code.length && ((code[m] >= '0' && code[m] <= '9') || code[m] === '.')) { num += code[m]; m++; }
        var val = parseFloat(num);
        if (isNaN(val)) err('「' + num + '」不是一个正常的数字', line);
        tokens.push({ t: 'num', v: val, line: line, isFloat: num.indexOf('.') >= 0 });
        i = m; continue;
      }

      // 两字符符号（必须先于单字符判断）
      if (code.startsWith('**', i)) { tokens.push({ t: 'op', v: '**', line: line }); i += 2; continue; }
      if (code.startsWith('//', i)) { tokens.push({ t: 'op', v: '//', line: line }); i += 2; continue; }

      // 硬关键字
      var hit = null;
      for (var h = 0; h < HARD.length; h++) {
        if (code.startsWith(HARD[h], i)) { hit = HARD[h]; break; }
      }
      if (hit) { tokens.push({ t: 'kw', v: hit, line: line }); i += hit.length; continue; }

      // 标识符
      if (RE_ID_START.test(raw)) {
        var n = i, id = '';
        while (n < code.length && RE_ID_BODY.test(code[n])) { id += code[n]; n++; }
        tokens.push({ t: 'id', v: id, line: line });
        i = n; continue;
      }

      // 单字符符号
      var ch = FULLWIDTH[raw] || raw;
      if (ch === ' ') { i++; continue; }
      if ('+-*/%&()[],'.indexOf(ch) >= 0) { tokens.push({ t: 'op', v: ch, line: line }); i++; continue; }

      if (ch === '=') err('这个语言里不用「=」', line, '定义一个值用「定义 名字 是 值」；比较两个值用「等于」');
      if (ch === '{' || ch === '}' || ch === ';') err('这个语言里不用「' + ch + '」', line, '一段程序用「结束」收尾就行');

      err('看不懂这个符号「' + raw + '」', line, '可以用的符号只有 + - * / // % ** ( ) [ ] , & 和引号');
    }

    tokens.push({ t: 'eof', v: '', line: line });
    return tokens;
  }

  /* ======================= 语法 ======================= */

  function parse(tokens) {
    var p = 0;

    function peek() { return tokens[p]; }
    function next() { return tokens[p++]; }
    function isKw(v) { var t = peek(); return t.t === 'kw' && t.v === v; }
    function isOp(v) { var t = peek(); return t.t === 'op' && t.v === v; }
    function soft(v) {
      var t = peek();
      if ((t.t === 'id' || t.t === 'kw') && t.v === v) { p++; return true; }
      return false;
    }
    function expectKw(v) {
      var t = peek();
      if (t.t === 'kw' && t.v === v) { p++; return; }
      err('这里应该有一个「' + v + '」', t.line, t.t === 'eof' ? '是不是最后忘了收尾？' : '');
    }
    function expectName() {
      var t = peek();
      if (t.t === 'id') { p++; return t.v; }
      if (t.t === 'kw') err('「' + t.v + '」是保留字，不能当名字用', t.line, '换一个名字吧');
      err('这里要写一个名字', t.line);
    }
    function isScalarType() {
      var t = peek();
      return t.t === 'kw' && TYPE_SCALAR[t.v];
    }

    /* ---------- 语句块 ---------- */

    function parseBlock(endKws) {
      var stmts = [];
      while (true) {
        var t = peek();
        if (t.t === 'op' && t.v === ',') { next(); continue; }
        if (t.t === 'eof') {
          if (endKws.length) {
            var want = endKws.indexOf('结束') >= 0 ? '结束' : endKws[0];
            err('少了「' + want + '」', t.line, '「如果 / 当 / 对于 / 定义 函数」都需要收尾');
          }
          break;
        }
        if (t.t === 'kw' && endKws.indexOf(t.v) >= 0) break;
        if (t.t === 'kw' && t.v === '结束') err('多了一个「结束」', t.line);
        if (t.t === 'kw' && t.v === '否则') err('「否则」前面要先有一个「如果」', t.line);
        if (t.t === 'kw' && t.v === '或者如果') err('「或者如果」前面要先有一个「如果」', t.line);
        stmts.push(parseStatement());
      }
      return stmts;
    }

    /* ---------- 语句 ---------- */

    function parseStatement() {
      var t = peek();
      if (t.t !== 'kw') {
        // 表达式语句：把函数调用单独写一行
        var nx = tokens[p + 1];
        if (t.t === 'id' && nx && nx.t === 'op' && nx.v === '(') {
          return { type: 'exprStmt', value: parseExpr(), line: t.line };
        }
        err('这句话读不懂，从「' + t.v + '」开始', t.line,
          '每一句话要用「定义 / 把 / 给 / 输出 / 如果 / 当 / 做 / 对于 / 返回」开头');
      }

      switch (t.v) {
        case '定义': return parseDefine();
        case '把': return parseAssign();
        case '给': return parseUpdate();
        case '说': case '输出':
          next();
          return { type: 'say', value: parseExpr(), line: t.line };
        case '如果': return parseIf();
        case '当': return parseWhile();
        case '做': return parseDoWhile();
        case '对于': return parseFor();
        case '停':
          next();
          return { type: 'break', line: t.line };
        case '返回': {
          next();
          var v = null;
          if (!isKw('结束') && peek().t !== 'eof' && !isKw('否则') && !isKw('或者如果')) v = parseExpr();
          return { type: 'return', value: v, line: t.line };
        }
        case '写': {
          next();
          var target = parseUnaryLevel();
          var content = parseExpr();
          return { type: 'fileWrite', target: target, content: content, line: t.line };
        }
        case '关闭':
          next();
          return { type: 'fileClose', target: parseUnaryLevel(), line: t.line };
      }

      err('「' + t.v + '」不能放在句子的开头', t.line);
    }

    /* ---- 定义 ---- */

    function parseDefine() {
      var t = next();

      if (isKw('函数')) {
        next();
        var fname = expectName();
        var params = [];
        if (isKw('参数')) next();
        while (true) {
          var pt = peek();
          if (pt.t === 'kw' && TYPE_SCALAR[pt.v]) {
            next();
            params.push({ name: expectName(), type: pt.v });
          } else if (pt.t === 'id') {
            next();
            params.push({ name: pt.v, type: null });
          } else break;
        }
        var body = parseBlock(['结束']);
        expectKw('结束');
        return { type: 'funcDef', name: fname, params: params, body: body, line: t.line };
      }

      if (isKw('指针')) {
        next();
        var pname = expectName();
        var target;
        if (soft('指向')) target = { type: 'addrOf', name: expectName(), line: t.line };
        else { soft('是'); target = parseExpr(); }
        return { type: 'let', name: pname, declared: '指针', value: target, line: t.line };
      }

      if (isKw('数组')) {
        next();
        var aname = expectName();
        if (isKw('长度')) {
          next();
          return { type: 'arrayNew', name: aname, length: parseExpr(), line: t.line };
        }
        soft('是');
        return { type: 'let', name: aname, declared: '数组', value: parseExpr(), line: t.line };
      }

      if (isKw('文件')) {
        next();
        var fname2 = expectName();
        soft('是');
        return { type: 'let', name: fname2, declared: '文件', value: parseExpr(), line: t.line };
      }

      if (isScalarType()) {
        var ty = next().v;
        var vname = expectName();
        soft('是');
        return { type: 'let', name: vname, declared: ty, value: parseExpr(), line: t.line };
      }

      var n2 = expectName();
      soft('是');
      return { type: 'let', name: n2, declared: null, value: parseExpr(), line: t.line };
    }

    /* ---- 赋值 ---- */

    function parseAssign() {
      var t = next();
      var target = parseTarget();
      soft('改成');
      return { type: 'assign', target: target, value: parseExpr(), line: t.line };
    }

    function parseUpdate() {
      var t = next();
      var target = parseTarget();
      var opTok = peek();
      var map = { '加上': '+', '减去': '-', '乘以': '*', '除以': '/' };
      if (opTok.t !== 'kw' || !map[opTok.v]) err('「给」后面要接「加上 / 减去 / 乘以 / 除以」', opTok.line);
      next();
      return { type: 'update', target: target, op: map[opTok.v], opText: opTok.v, value: parseExpr(), line: t.line };
    }

    function parseTarget() {
      var t = peek();
      if (t.t === 'op' && t.v === '*') { next(); return { type: 'deref', value: parseTarget(), line: t.line }; }
      if (t.t === 'id') {
        next();
        var node = { type: 'var', name: t.v, line: t.line };
        while (isOp('[')) {
          next();
          var idx = parseExpr();
          if (!isOp(']')) err('这个方括号没有关上', t.line);
          next();
          node = { type: 'index', obj: node, index: idx, line: t.line };
        }
        return node;
      }
      err('这里要写一个变量名', t.line);
    }

    /* ---- 分支 ---- */

    function parseIf() {
      var t = next();
      var branches = [];
      branches.push({ cond: parseExpr(), body: parseBlock(['否则', '或者如果', '结束']) });

      while (isKw('或者如果')) {
        next();
        branches.push({ cond: parseExpr(), body: parseBlock(['否则', '或者如果', '结束']) });
      }

      var elseB = null;
      if (isKw('否则')) { next(); elseB = parseBlock(['结束']); }
      expectKw('结束');
      return { type: 'if', branches: branches, other: elseB, line: t.line };
    }

    /* ---- 循环 ---- */

    function parseWhile() {
      var t = next();
      var cond = parseExpr();
      if (isKw('做')) next();
      var body = parseBlock(['结束']);
      expectKw('结束');
      return { type: 'while', cond: cond, body: body, line: t.line };
    }

    function parseDoWhile() {
      var t = next();
      var body = parseBlock(['结束当']);
      expectKw('结束当');
      var cond = parseExpr();
      return { type: 'doWhile', cond: cond, body: body, line: t.line };
    }

    function parseFor() {
      var t = next();
      var name = expectName();
      soft('从');
      var from = parseExpr();
      soft('到');
      var to = parseExpr();
      var step = null;
      if (soft('步长')) step = parseExpr();
      var body = parseBlock(['结束']);
      expectKw('结束');
      return { type: 'for', name: name, from: from, to: to, step: step, body: body, line: t.line };
    }

    /* ---------- 表达式 ---------- */

    function parseExpr() { return parseOr(); }

    function parseOr() {
      var l = parseAnd();
      while (isKw('或')) {
        var t = next();
        l = { type: 'bin', op: '或', left: l, right: parseAnd(), line: t.line };
      }
      return l;
    }

    function parseAnd() {
      var l = parseNot();
      while (isKw('与')) {
        var t = next();
        l = { type: 'bin', op: '与', left: l, right: parseNot(), line: t.line };
      }
      return l;
    }

    function parseNot() {
      if (isKw('非')) { var t = next(); return { type: 'un', op: '非', value: parseNot(), line: t.line }; }
      return parseCompare();
    }

    var CMP = ['大于等于', '小于等于', '不等于', '大于', '小于', '等于'];

    function parseCompare() {
      var l = parseAdd();
      var t = peek();
      if (t.t === 'kw' && CMP.indexOf(t.v) >= 0) {
        next();
        return { type: 'bin', op: t.v, left: l, right: parseAdd(), line: t.line };
      }
      return l;
    }

    var ADD_WORD = { '加': '+', '减': '-' };
    var MUL_WORD = { '乘': '*', '除': '/', '整除': '//', '取余': '%', '乘方': '**' };

    function parseAdd() {
      var l = parseMul();
      while (true) {
        var t = peek();
        if (t.t === 'op' && (t.v === '+' || t.v === '-')) {
          next(); l = { type: 'bin', op: t.v, left: l, right: parseMul(), line: t.line };
        } else if (t.t === 'id' && ADD_WORD[t.v]) {
          next(); l = { type: 'bin', op: ADD_WORD[t.v], left: l, right: parseMul(), line: t.line };
        } else break;
      }
      return l;
    }

    function parseMul() {
      var l = parseUnary();
      while (true) {
        var t = peek();
        if (t.t === 'op' && (t.v === '*' || t.v === '/' || t.v === '//' || t.v === '%')) {
          next(); l = { type: 'bin', op: t.v, left: l, right: parseUnary(), line: t.line };
        } else if ((t.t === 'id' || t.t === 'kw') && MUL_WORD[t.v]) {
          next(); l = { type: 'bin', op: MUL_WORD[t.v], left: l, right: parseUnary(), line: t.line };
        } else break;
      }
      return l;
    }

    function parseUnary() {
      var t = peek();
      if (t.t === 'op' && t.v === '-') { next(); return { type: 'un', op: '-', value: parseUnary(), line: t.line }; }
      if (t.t === 'op' && t.v === '+') { next(); return parseUnary(); }
      if (t.t === 'op' && t.v === '*') { next(); return { type: 'deref', value: parseUnary(), line: t.line }; }
      if (t.t === 'op' && t.v === '&') { next(); return { type: 'addrOf', name: expectName(), line: t.line }; }
      if (t.t === 'kw' && t.v === '取地址') { next(); return { type: 'addrOf', name: expectName(), line: t.line }; }
      if (t.t === 'kw' && t.v === '地址') { next(); return { type: 'addrText', name: expectName(), line: t.line }; }
      return parsePow();
    }

    function parsePow() {
      var l = parseAtom();
      if (isOp('**')) {
        var t = next();
        return { type: 'bin', op: '**', left: l, right: parseUnary(), line: t.line };
      }
      return l;
    }

    function parseAtom() {
      var t = peek();

      if (t.t === 'num') { next(); return { type: 'num', value: t.v, line: t.line }; }
      if (t.t === 'str') { next(); return { type: 'str', value: t.v, line: t.line }; }
      if (t.t === 'chr') { next(); return { type: 'chr', value: t.v, line: t.line }; }
      if (t.t === 'kw' && t.v === '真') { next(); return { type: 'bool', value: true, line: t.line }; }
      if (t.t === 'kw' && t.v === '假') { next(); return { type: 'bool', value: false, line: t.line }; }

      if (t.t === 'op' && t.v === '(') {
        next();
        var e = parseExpr();
        if (!isOp(')')) err('这个括号没有关上', t.line);
        next();
        return e;
      }

      // 数组字面量
      if (t.t === 'op' && t.v === '[') {
        next();
        var items = [];
        while (!isOp(']')) {
          items.push(parseExpr());
          if (isOp(',')) { next(); continue; }
          if (isOp(']')) break;
          err('数组元素之间要用逗号隔开', t.line);
        }
        next();
        return { type: 'arrayLit', items: items, line: t.line };
      }

      // 类型转换
      if (t.t === 'kw' && (t.v === '整型' || t.v === '浮点型' || t.v === '字符串' || t.v === '布尔型')) {
        next();
        if (!isOp('(')) err('类型转换要这样写：' + t.v + '(值)', t.line);
        next();
        var inner = parseExpr();
        if (!isOp(')')) err('这个括号没有关上', t.line);
        next();
        return { type: 'cast', to: t.v, value: inner, line: t.line };
      }

      // 打开文件
      if (t.t === 'kw' && t.v === '打开文件') {
        next();
        var nameE = parseUnaryLevel();
        soft('为');
        var mode = '读';
        var mt = peek();
        if (mt.t === 'kw' && (mt.v === '读' || mt.v === '写' || mt.v === '追加')) { next(); mode = mt.v; }
        return { type: 'fileOpen', name: nameE, mode: mode, line: t.line };
      }

      // 内置前缀函数
      if (t.t === 'kw' && ['随机', '绝对值', '长度', '余数', '输入', '读'].indexOf(t.v) >= 0) {
        var fnName = t.v;
        next();
        var castType = null;
        if (fnName === '输入' && isScalarType()) castType = next().v;
        var a = parseUnaryLevel();
        if (fnName === '随机') {
          soft('到');
          return { type: 'callNative', fn: '随机', args: [a, parseUnaryLevel()], line: t.line };
        }
        if (fnName === '余数') {
          soft('除以');
          return { type: 'callNative', fn: '余数', args: [a, parseUnaryLevel()], line: t.line };
        }
        return { type: 'callNative', fn: fnName, args: [a], cast: castType, line: t.line };
      }

      // 变量 / 函数调用 / 下标
      if (t.t === 'id') {
        next();
        var name = t.v;
        if (isOp('(')) {
          next();
          var args = [];
          while (!isOp(')')) {
            args.push(parseExpr());
            if (isOp(',')) { next(); continue; }
            if (isOp(')')) break;
            err('函数参数之间要用逗号隔开', t.line);
          }
          next();
          return parsePostfix({ type: 'call', name: name, args: args, line: t.line });
        }
        return parsePostfix({ type: 'var', name: name, line: t.line });
      }

      if (t.t === 'eof') err('这句话还没写完', t.line);
      err('这里应该是一个值，而不是「' + t.v + '」', t.line);
    }

    function parsePostfix(node) {
      var t = peek();
      if (t.t === 'op' && t.v === '[') {
        next();
        var idx = parseExpr();
        if (!isOp(']')) err('这个方括号没有关上', t.line);
        next();
        return parsePostfix({ type: 'index', obj: node, index: idx, line: t.line });
      }
      if (t.t === 'id' && t.v === '的值') {
        next();
        return parsePostfix({ type: 'deref', value: node, line: t.line });
      }
      return node;
    }

    function parseUnaryLevel() {
      var t = peek();
      if (t.t === 'op' && t.v === '-') { next(); return { type: 'un', op: '-', value: parseUnaryLevel(), line: t.line }; }
      if (t.t === 'kw' && t.v === '非') { next(); return { type: 'un', op: '非', value: parseUnaryLevel(), line: t.line }; }
      return parsePow();
    }

    return parseBlock([]);
  }

  /* ======================= 运行时值 ======================= */

  function typeLabel(v) {
    if (v === null || v === undefined) return '空';
    if (v && v.__ptr) return '指针';
    if (v && v.__file) return '文件';
    if (v && v.__func) return '函数';
    if (Array.isArray(v)) return '数组';
    if (typeof v === 'number') return Number.isInteger(v) ? '整型' : '浮点型';
    if (typeof v === 'boolean') return '布尔型';
    if (typeof v === 'string') return '字符串';
    return '未知';
  }

  function fmt(v) {
    if (v === null || v === undefined) return '空';
    if (typeof v === 'number') {
      if (!isFinite(v)) return String(v);
      if (Number.isInteger(v)) return String(v);
      return String(Math.round(v * 1e8) / 1e8);
    }
    if (typeof v === 'boolean') return v ? '真' : '假';
    if (typeof v === 'string') return v;
    if (Array.isArray(v)) return '[' + v.map(fmt).join(', ') + ']';
    if (v && v.__ptr) return '&' + v.__ptr.name;
    if (v && v.__file) return '文件「' + v.__file.name + '」';
    if (v && v.__func) return '函数 ' + v.__func.name;
    return String(v);
  }

  /* ======================= 作用域 ======================= */

  function Scope(parent, label) {
    this.vars = new Map();
    this.parent = parent || null;
    this.label = label || '';
  }

  Scope.prototype.find = function (name) {
    if (this.vars.has(name)) return this;
    return this.parent ? this.parent.find(name) : null;
  };

  Scope.prototype.get = function (name) {
    var s = this.find(name);
    return s ? s.vars.get(name) : null;
  };

  Scope.prototype.define = function (name, value, declared) {
    this.vars.set(name, { value: value, declared: declared || null });
  };

  /* ======================= 类型检查 ======================= */

  function coerceTo(value, declared, line, name) {
    if (!declared) return value;

    switch (declared) {
      case '整型':
        if (typeof value === 'number' && Number.isInteger(value)) return value;
        if (typeof value === 'string') {
          var n = Number(value.trim());
          if (value.trim() !== '' && !isNaN(n) && Number.isInteger(n)) return n;
        }
        if (typeof value === 'number') err('「' + name + '」是整型，不能放小数 ' + fmt(value), line, '想放小数请用「定义 浮点型」');
        err('「' + name + '」是整型，不能放' + typeLabel(value) + '「' + fmt(value) + '」', line);

      case '浮点型':
        if (typeof value === 'number') return value;
        if (typeof value === 'string') {
          var f = Number(value.trim());
          if (value.trim() !== '' && !isNaN(f)) return f;
        }
        err('「' + name + '」是浮点型，不能放' + typeLabel(value), line);

      case '布尔型':
        if (typeof value === 'boolean') return value;
        err('「' + name + '」是布尔型，只能放「真」或「假」', line);

      case '字符型':
        if (typeof value === 'string' && value.length === 1) return value;
        err('「' + name + '」是字符型，只能放一个字符', line, "比如 'A'");

      case '字符串':
        if (typeof value === 'string') return value;
        err('「' + name + '」是字符串，不能放' + typeLabel(value), line, '可以用 字符串(值) 转换');

      case '数组':
        if (Array.isArray(value)) return value;
        err('「' + name + '」是数组，不能放' + typeLabel(value), line);

      case '指针':
        if (value && value.__ptr) return value;
        err('「' + name + '」是指针，要用 &变量名 或「指向 变量名」给它赋值', line);

      case '文件':
        if (value && value.__file) return value;
        err('「' + name + '」是文件，要用 打开文件 得到', line);
    }
    return value;
  }

  /* ======================= 求值 ======================= */

  var CMP_OPS = { '大于': 1, '小于': 1, '等于': 1, '不等于': 1, '大于等于': 1, '小于等于': 1 };

  function needNum(v, line, what) {
    if (typeof v === 'number') return v;
    if (typeof v === 'boolean') err('「' + what + '」需要数字，这里是布尔值「' + fmt(v) + '」', line);
    err('「' + what + '」需要数字，这里是' + typeLabel(v) + '「' + fmt(v) + '」', line);
  }

  function evalExpr(e, ctx, scope) {
    switch (e.type) {
      case 'num': case 'str': case 'chr': case 'bool': return e.value;

      case 'arrayLit': {
        var arr = [];
        for (var i = 0; i < e.items.length; i++) arr.push(evalExpr(e.items[i], ctx, scope));
        return arr;
      }

      case 'cast': {
        var cv = evalExpr(e.value, ctx, scope);
        if (e.to === '整型') {
          if (typeof cv === 'number') return Math.trunc(cv);
          if (typeof cv === 'boolean') return cv ? 1 : 0;
          if (typeof cv === 'string') {
            var n1 = Number(cv.trim());
            if (cv.trim() === '' || isNaN(n1)) err('「' + cv + '」不能变成整型', e.line);
            return Math.trunc(n1);
          }
        }
        if (e.to === '浮点型') {
          if (typeof cv === 'number') return cv;
          if (typeof cv === 'boolean') return cv ? 1 : 0;
          if (typeof cv === 'string') {
            var n2 = Number(cv.trim());
            if (cv.trim() === '' || isNaN(n2)) err('「' + cv + '」不能变成浮点型', e.line);
            return n2;
          }
        }
        if (e.to === '字符串') return fmt(cv);
        if (e.to === '布尔型') {
          if (typeof cv === 'boolean') return cv;
          if (typeof cv === 'number') return cv !== 0;
          if (typeof cv === 'string') return cv !== '';
        }
        return cv;
      }

      case 'var': {
        var rec = scope.get(e.name);
        if (!rec) err('还没有定义「' + e.name + '」', e.line, '先用「定义 ' + e.name + ' 是 0」给它一个值');
        return rec.value;
      }

      case 'index': {
        var obj = evalExpr(e.obj, ctx, scope);
        var idx = needNum(evalExpr(e.index, ctx, scope), e.line, '下标');
        if (!Array.isArray(obj)) err('只有数组才能用 [ ] 取元素，这里是' + typeLabel(obj), e.line);
        if (!Number.isInteger(idx)) err('下标必须是整数', e.line);
        if (idx < 0 || idx >= obj.length) {
          err('数组只有 ' + obj.length + ' 个元素，取不到第 ' + idx + ' 个', e.line, '下标从 0 开始数');
        }
        return obj[idx];
      }

      case 'deref': {
        var pv = evalExpr(e.value, ctx, scope);
        if (!pv || !pv.__ptr) err('「*」后面要跟一个指针，这里是' + typeLabel(pv), e.line, '用 &变量名 可以取到指针');
        var ts = pv.__ptr.scope.find(pv.__ptr.name);
        if (!ts) err('指针指向的「' + pv.__ptr.name + '」已经不存在了', e.line);
        return ts.vars.get(pv.__ptr.name).value;
      }

      case 'addrOf': {
        var s = scope.find(e.name);
        if (!s) err('还没有定义「' + e.name + '」', e.line);
        return { __ptr: { scope: s, name: e.name } };
      }

      case 'addrText': return ctx.addrOf(e.name);

      case 'un': {
        var u = evalExpr(e.value, ctx, scope);
        if (e.op === '非') {
          if (typeof u !== 'boolean') err('「非」只能用在布尔值上', e.line);
          return !u;
        }
        return -needNum(u, e.line, '负号');
      }

      case 'bin': return evalBinary(e, ctx, scope);

      case 'callNative': return callNative(e, ctx, scope);

      case 'fileOpen': {
        var fname = fmt(evalExpr(e.name, ctx, scope));
        if (e.mode === '写') ctx.fs.write(fname, '', false);
        return { __file: { name: fname, mode: e.mode, pos: 0 } };
      }

      case 'call': return callFunction(e, ctx, scope);
    }
    err('这一小段算不出来', e.line);
  }

  function hashStr(s) {
    var h = 0;
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return h;
  }

  function evalBinary(e, ctx, scope) {
    var op = e.op;

    if (op === '与') {
      var L = evalExpr(e.left, ctx, scope);
      if (typeof L !== 'boolean') err('「与」的两边都要是布尔值，比如「a 大于 1 与 b 小于 3」', e.line);
      if (!L) return false;
      var R = evalExpr(e.right, ctx, scope);
      if (typeof R !== 'boolean') err('「与」的两边都要是布尔值', e.line);
      return R;
    }
    if (op === '或') {
      var L2 = evalExpr(e.left, ctx, scope);
      if (typeof L2 !== 'boolean') err('「或」的两边都要是布尔值', e.line);
      if (L2) return true;
      var R2 = evalExpr(e.right, ctx, scope);
      if (typeof R2 !== 'boolean') err('「或」的两边都要是布尔值', e.line);
      return R2;
    }

    var a = evalExpr(e.left, ctx, scope);
    var b = evalExpr(e.right, ctx, scope);

    if (CMP_OPS[op]) {
      if (typeof a !== typeof b) {
        err('不能拿' + typeLabel(a) + '「' + fmt(a) + '」和' + typeLabel(b) + '「' + fmt(b) + '」比大小', e.line);
      }
      if (Array.isArray(a) || (a && (a.__ptr || a.__file))) err('数组、指针、文件不能用比较符号', e.line);
      switch (op) {
        case '大于': return a > b;
        case '小于': return a < b;
        case '等于': return a === b;
        case '不等于': return a !== b;
        case '大于等于': return a >= b;
        case '小于等于': return a <= b;
      }
    }

    if (op === '+') {
      if (typeof a === 'string' || typeof b === 'string') return fmt(a) + fmt(b);
      return needNum(a, e.line, '加法') + needNum(b, e.line, '加法');
    }

    if (op === '*') {
      if (typeof a === 'string' && typeof b === 'number') {
        if (!Number.isInteger(b) || b < 0) err('文字只能乘一个非负整数', e.line);
        return a.repeat(b);
      }
      if (typeof b === 'string' && typeof a === 'number') {
        if (!Number.isInteger(a) || a < 0) err('文字只能乘一个非负整数', e.line);
        return b.repeat(a);
      }
      return needNum(a, e.line, '乘法') * needNum(b, e.line, '乘法');
    }

    if (op === '**') {
      var r = Math.pow(needNum(a, e.line, '乘方'), needNum(b, e.line, '乘方'));
      if (!isFinite(r)) err('这个乘方结果太大了', e.line);
      return r;
    }

    if (op === '%' || op === '//') {
      var ma = needNum(a, e.line, op === '%' ? '取余' : '整除');
      var mb = needNum(b, e.line, op === '%' ? '取余' : '整除');
      if (mb === 0) err(op === '%' ? '不能对 0 取余' : '不能除以 0', e.line);
      if (op === '//') return Math.floor(ma / mb);
      var mr = ma % mb;
      if (mr !== 0 && ((mr < 0) !== (mb < 0))) mr += mb;   // 仿 Python：余数符号跟除数
      return mr;
    }

    if (op === '-') return needNum(a, e.line, '减法') - needNum(b, e.line, '减法');

    if (op === '/') {
      var x = needNum(a, e.line, '除法');
      var y = needNum(b, e.line, '除法');
      if (y === 0) err('不能除以 0', e.line);
      return x / y;
    }

    err('不认识的运算符「' + op + '」', e.line);
  }

  function callNative(e, ctx, scope) {
    var fn = e.fn;

    if (fn === '输入') {
      var promptText = e.args.length ? fmt(evalExpr(e.args[0], ctx, scope)) : '';
      var ans = ctx.ask(promptText);
      ans = ans === null || ans === undefined ? '' : String(ans);
      if (e.cast === '整型') { var n1 = Number(ans.trim()); return (ans.trim() === '' || isNaN(n1)) ? 0 : Math.trunc(n1); }
      if (e.cast === '浮点型') { var n2 = Number(ans.trim()); return (ans.trim() === '' || isNaN(n2)) ? 0 : n2; }
      return ans;
    }

    if (fn === '读') {
      var fobj = evalExpr(e.args[0], ctx, scope);
      if (!fobj || !fobj.__file) err('「读」后面要跟一个打开的文件', e.line);
      if (fobj.__file.mode === '写') err('这个文件是以「写」打开的，不能读', e.line, '用「打开文件 ... 为 读」');
      var content = ctx.fs.read(fobj.__file.name);
      if (content === null) err('文件「' + fobj.__file.name + '」不存在', e.line);
      var lines = content.split('\n');
      if (lines.length && lines[lines.length - 1] === '') lines.pop();
      if (fobj.__file.pos >= lines.length) return '';
      return lines[fobj.__file.pos++];
    }

    if (fn === '随机') {
      var lo = Math.ceil(needNum(evalExpr(e.args[0], ctx, scope), e.line, '随机'));
      var hi = Math.floor(needNum(evalExpr(e.args[1], ctx, scope), e.line, '随机'));
      if (lo > hi) err('「随机」的第一个数不能比第二个大', e.line);
      return lo + Math.floor(ctx.rng() * (hi - lo + 1));
    }

    var val = evalExpr(e.args[0], ctx, scope);

    if (fn === '绝对值') return Math.abs(needNum(val, e.line, '绝对值'));

    if (fn === '长度') {
      if (typeof val === 'string') return val.length;
      if (Array.isArray(val)) return val.length;
      err('「长度」只能算文字或数组的长度', e.line);
    }

    if (fn === '余数') {
      var aa = needNum(val, e.line, '余数');
      var bb = needNum(evalExpr(e.args[1], ctx, scope), e.line, '余数');
      if (bb === 0) err('不能对 0 取余', e.line);
      var rr = aa % bb;
      if (rr !== 0 && ((rr < 0) !== (bb < 0))) rr += bb;
      return rr;
    }

    err('不认识的内置函数「' + fn + '」', e.line);
  }

  /* ======================= 虚拟文件系统 ======================= */

  function createFS() {
    var files = new Map();
    return {
      files: files,
      read: function (name) { return files.has(name) ? files.get(name) : null; },
      write: function (name, text, append) {
        if (append && files.has(name)) files.set(name, files.get(name) + text);
        else files.set(name, text);
      },
      list: function () {
        var out = [];
        files.forEach(function (v, k) { out.push([k, v]); });
        return out;
      }
    };
  }

  /* ======================= 解释器 ======================= */

  function snapshot(ctx, line, narration, extra) {
    var vars = [];
    var seen = {};
    var s = ctx.scope;
    while (s) {
      s.vars.forEach(function (rec, k) {
        if (seen[k]) return;
        seen[k] = 1;
        vars.push([k, rec.value, rec.declared]);
      });
      s = s.parent;
    }
    var snap = {
      line: line,
      narration: narration,
      vars: vars,
      output: ctx.output.slice(),
      files: ctx.fs.list(),
      steps: ctx.steps
    };
    if (extra) for (var k in extra) snap[k] = extra[k];
    return snap;
  }

  // 函数调用产生的内部步骤先攒起来，再由 emit 按时间顺序吐出
  function* emit(ctx, line, narration, extra) {
    while (ctx.pending.length) yield ctx.pending.shift();
    yield snapshot(ctx, line, narration, extra);
  }

  function* execBlock(stmts, ctx, scope) {
    for (var i = 0; i < stmts.length; i++) {
      var r = yield* execStmt(stmts[i], ctx, scope);
      if (r === 'break' || r === 'return') return r;
    }
    return 'normal';
  }

  function* execStmt(s, ctx, scope) {
    ctx.steps++;
    if (ctx.steps > MAX_STEPS) {
      err('程序跑了 ' + MAX_STEPS + ' 步还没停', s.line, '检查一下循环条件是不是永远成立');
    }

    switch (s.type) {
      case 'let': {
        var v = evalExpr(s.value, ctx, scope);
        v = coerceTo(v, s.declared, s.line, s.name);
        scope.define(s.name, v, s.declared);
        yield* emit(ctx, s.line, '定义 ' + (s.declared ? s.declared + ' ' : '') + s.name + ' = ' + fmt(v), { focus: s.name });
        return 'normal';
      }

      case 'arrayNew': {
        var len = needNum(evalExpr(s.length, ctx, scope), s.line, '数组长度');
        if (!Number.isInteger(len) || len < 0) err('数组长度要是一个非负整数', s.line);
        if (len > 10000) err('数组最长 10000 个', s.line);
        var arr = [];
        for (var q = 0; q < len; q++) arr.push(0);
        scope.define(s.name, arr, '数组');
        yield* emit(ctx, s.line, '定义 数组 ' + s.name + '，长度 ' + len, { focus: s.name });
        return 'normal';
      }

      case 'assign': {
        var nv = evalExpr(s.value, ctx, scope);
        assignTo(s.target, nv, ctx, scope, s.line);
        yield* emit(ctx, s.line, '把 ' + targetText(s.target) + ' 改成 ' + fmt(nv), { focus: targetFocus(s.target) });
        return 'normal';
      }

      case 'update': {
        var old = evalExpr(s.target, ctx, scope);
        var rhs = evalExpr(s.value, ctx, scope);
        var res;
        if (s.op === '+' && (typeof old === 'string' || typeof rhs === 'string')) res = fmt(old) + fmt(rhs);
        else if (s.op === '+') res = needNum(old, s.line, s.opText) + needNum(rhs, s.line, s.opText);
        else if (s.op === '-') res = needNum(old, s.line, s.opText) - needNum(rhs, s.line, s.opText);
        else if (s.op === '*') res = needNum(old, s.line, s.opText) * needNum(rhs, s.line, s.opText);
        else {
          var dd = needNum(rhs, s.line, s.opText);
          if (dd === 0) err('不能除以 0', s.line);
          res = needNum(old, s.line, s.opText) / dd;
        }
        assignTo(s.target, res, ctx, scope, s.line);
        yield* emit(ctx, s.line, targetText(s.target) + '：' + fmt(old) + ' → ' + fmt(res),
          { focus: targetFocus(s.target), changed: true });
        return 'normal';
      }

      case 'say': {
        var out = evalExpr(s.value, ctx, scope);
        ctx.output.push(fmt(out));
        yield* emit(ctx, s.line, '输出：' + fmt(out));
        return 'normal';
      }

      case 'exprStmt': {
        evalExpr(s.value, ctx, scope);
        yield* emit(ctx, s.line, '执行 ' + astText(s.value));
        return 'normal';
      }

      case 'if': {
        for (var bi = 0; bi < s.branches.length; bi++) {
          var br = s.branches[bi];
          var c = evalExpr(br.cond, ctx, scope);
          if (typeof c !== 'boolean') err('「如果」后面要写一个判断，比如「分数 大于 60」', s.line);
          var label = bi === 0 ? '如果' : '或者如果';
          if (c) {
            yield* emit(ctx, s.line, label + ' [' + astText(br.cond) + '] → 成立');
            return yield* execBlock(br.body, ctx, scope);
          }
          yield* emit(ctx, s.line, label + ' [' + astText(br.cond) + '] → 不成立');
        }
        if (s.other) {
          yield* emit(ctx, s.line, '走到「否则」');
          return yield* execBlock(s.other, ctx, scope);
        }
        yield* emit(ctx, s.line, '所有条件都不成立，跳过');
        return 'normal';
      }

      case 'while': {
        var round = 0;
        while (true) {
          var wc = evalExpr(s.cond, ctx, scope);
          if (typeof wc !== 'boolean') err('「当」后面要写一个判断', s.line);
          if (!wc) { yield* emit(ctx, s.line, '当 [' + astText(s.cond) + '] → 不成立，循环结束'); break; }
          round++;
          yield* emit(ctx, s.line, '当 [' + astText(s.cond) + '] → 成立，第 ' + round + ' 圈');
          var wr = yield* execBlock(s.body, ctx, scope);
          if (wr === 'break') { yield* emit(ctx, s.line, '执行「停」，跳出循环'); break; }
          if (wr === 'return') return 'return';
        }
        return 'normal';
      }

      case 'doWhile': {
        var dr = 0;
        while (true) {
          dr++;
          var rb = yield* execBlock(s.body, ctx, scope);
          if (rb === 'break') { yield* emit(ctx, s.line, '执行「停」，跳出循环'); break; }
          if (rb === 'return') return 'return';
          var dc = evalExpr(s.cond, ctx, scope);
          if (typeof dc !== 'boolean') err('「结束当」后面要写一个判断', s.line);
          yield* emit(ctx, s.line, '第 ' + dr + ' 圈跑完，检查 [' + astText(s.cond) + '] → ' + (dc ? '继续' : '结束'));
          if (!dc) break;
        }
        return 'normal';
      }

      case 'for': {
        var from = needNum(evalExpr(s.from, ctx, scope), s.line, '起点');
        var to = needNum(evalExpr(s.to, ctx, scope), s.line, '终点');
        var step = s.step ? needNum(evalExpr(s.step, ctx, scope), s.line, '步长') : (to >= from ? 1 : -1);
        if (step === 0) err('步长不能是 0', s.line);
        var loopScope = new Scope(scope, 'for');
        var counter = from, n = 0;
        var prevScope = ctx.scope;
        while (step > 0 ? counter <= to : counter >= to) {
          loopScope.define(s.name, counter, null);
          n++;
          ctx.scope = loopScope;
          yield* emit(ctx, s.line, '对于 ' + s.name + ' = ' + counter + '（第 ' + n + ' 次）', { focus: s.name });
          var fr = yield* execBlock(s.body, ctx, loopScope);
          ctx.scope = prevScope;
          if (fr === 'break') { yield* emit(ctx, s.line, '执行「停」，跳出循环'); break; }
          if (fr === 'return') return 'return';
          counter += step;
        }
        ctx.scope = prevScope;
        return 'normal';
      }

      case 'break':
        yield* emit(ctx, s.line, '执行「停」');
        return 'break';

      case 'return': {
        var rv = s.value ? evalExpr(s.value, ctx, scope) : null;
        ctx.returnValue = rv;
        yield* emit(ctx, s.line, '返回 ' + (s.value ? fmt(rv) : '（空）'));
        return 'return';
      }

      case 'funcDef':
        scope.define(s.name, { __func: s, scope: scope }, '函数');
        yield* emit(ctx, s.line, '定义函数 ' + s.name + '(' + s.params.map(function (x) { return x.name; }).join(', ') + ')');
        return 'normal';

      case 'fileWrite': {
        var fv = evalExpr(s.target, ctx, scope);
        if (!fv || !fv.__file) err('「写」后面要跟一个打开的文件', s.line);
        if (fv.__file.mode === '读') err('这个文件是以「读」打开的，不能写', s.line, '想写请用「打开文件 ... 为 写」');
        var txt = fmt(evalExpr(s.content, ctx, scope));
        ctx.fs.write(fv.__file.name, txt + '\n', true);
        yield* emit(ctx, s.line, '写入「' + fv.__file.name + '」：' + txt);
        return 'normal';
      }

      case 'fileClose': {
        var cf = evalExpr(s.target, ctx, scope);
        if (!cf || !cf.__file) err('「关闭」后面要跟一个打开的文件', s.line);
        yield* emit(ctx, s.line, '关闭文件「' + cf.__file.name + '」');
        return 'normal';
      }
    }

    err('不认识的语句', s.line);
  }

  function targetText(t) {
    if (t.type === 'var') return t.name;
    if (t.type === 'index') return targetText(t.obj) + '[' + astText(t.index) + ']';
    if (t.type === 'deref') return '*' + targetText(t.value);
    return '?';
  }

  function targetFocus(t) {
    if (t.type === 'var') return t.name;
    if (t.type === 'index') return targetFocus(t.obj);
    if (t.type === 'deref') return targetFocus(t.value);
    return null;
  }

  function assignTo(target, value, ctx, scope, line) {
    if (target.type === 'var') {
      var s = scope.find(target.name);
      if (!s) err('还没有定义「' + target.name + '」', line, '先用「定义 ' + target.name + ' 是 ...」给它一个值');
      var rec = s.vars.get(target.name);
      rec.value = coerceTo(value, rec.declared, line, target.name);
      return;
    }
    if (target.type === 'index') {
      var obj = evalExpr(target.obj, ctx, scope);
      var idx = needNum(evalExpr(target.index, ctx, scope), line, '下标');
      if (!Array.isArray(obj)) err('只有数组才能用 [ ] 存东西', line);
      if (!Number.isInteger(idx)) err('下标必须是整数', line);
      if (idx < 0 || idx >= obj.length) err('数组只有 ' + obj.length + ' 个元素，写不进第 ' + idx + ' 个', line, '下标从 0 开始数');
      obj[idx] = value;
      return;
    }
    if (target.type === 'deref') {
      var pv = evalExpr(target.value, ctx, scope);
      if (!pv || !pv.__ptr) err('「*」后面要跟一个指针', line);
      var ts = pv.__ptr.scope.find(pv.__ptr.name);
      if (!ts) err('指针指向的「' + pv.__ptr.name + '」已经不存在了', line);
      var prec = ts.vars.get(pv.__ptr.name);
      prec.value = coerceTo(value, prec.declared, line, pv.__ptr.name);
      return;
    }
    err('这里不能赋值', line);
  }

  // 函数调用：同步驱动内部 generator，把过程步骤攒进 buffer，再由外层 emit 吐出
  function callFunction(node, ctx, outerScope) {
    var rec = outerScope.get(node.name);
    if (!rec) err('还没有定义「' + node.name + '」这个函数', node.line, '用「定义 函数 ' + node.name + ' 参数 ...」先定义它');
    if (!rec.value || !rec.value.__func) err('「' + node.name + '」不是一个函数，不能这样调用', node.line);

    var fn = rec.value.__func;
    if (node.args.length !== fn.params.length) {
      err('函数 ' + node.name + ' 需要 ' + fn.params.length + ' 个参数，你给了 ' + node.args.length + ' 个', node.line);
    }

    ctx.depth++;
    if (ctx.depth > MAX_DEPTH) { ctx.depth--; err('函数调用太深了，可能是无限递归', node.line); }

    var argVals = [];
    for (var i = 0; i < node.args.length; i++) argVals.push(evalExpr(node.args[i], ctx, outerScope));

    // 词法作用域：新调用的父作用域是「定义处」，不是「调用处」，递归链才不会无限增长
    var callScope = new Scope(rec.value.scope || outerScope, fn.name);
    for (var j = 0; j < fn.params.length; j++) {
      var p = fn.params[j];
      callScope.define(p.name, coerceTo(argVals[j], p.type, node.line, p.name), p.type);
    }

    var prevScope = ctx.scope;
    var prevRet = ctx.returnValue;
    var prevPending = ctx.pending;
    ctx.pending = [];            // 隔离：避免 emit 与本次收集互相倒腾
    ctx.scope = callScope;
    ctx.returnValue = null;

    var buf = [];
    try {
      var gen = (function* () {
        yield snapshot(ctx, node.line, '进入函数 ' + node.name + '(' + argVals.map(fmt).join(', ') + ')');
        yield* execBlock(fn.body, ctx, callScope);
        yield snapshot(ctx, node.line, '离开函数 ' + node.name);
      })();
      var r = gen.next();
      while (!r.done) { buf.push(r.value); r = gen.next(); }
    } finally {
      ctx.scope = prevScope;
      ctx.pending = prevPending;
      ctx.depth--;
    }

    var rv = ctx.returnValue;
    ctx.returnValue = prevRet;

    for (var k = 0; k < buf.length; k++) ctx.pending.push(buf[k]);
    return rv;
  }

  /* ======================= AST 文字化 ======================= */

  function astText(e) {
    if (!e) return '';
    switch (e.type) {
      case 'num': return fmt(e.value);
      case 'str': return '"' + e.value + '"';
      case 'chr': return "'" + e.value + "'";
      case 'bool': return e.value ? '真' : '假';
      case 'var': return e.name;
      case 'un': return (e.op === '非' ? '非 ' : '-') + astText(e.value);
      case 'bin': return astText(e.left) + ' ' + e.op + ' ' + astText(e.right);
      case 'index': return astText(e.obj) + '[' + astText(e.index) + ']';
      case 'deref': return '*' + astText(e.value);
      case 'addrOf': return '&' + e.name;
      case 'addrText': return '地址 ' + astText(e.value);
      case 'cast': return e.to + '(' + astText(e.value) + ')';
      case 'arrayLit': return '[' + e.items.map(astText).join(', ') + ']';
      case 'call': return e.name + '(' + e.args.map(astText).join(', ') + ')';
      case 'fileOpen': return '打开文件 ' + astText(e.name);
      case 'callNative':
        if (e.fn === '随机') return '随机 ' + astText(e.args[0]) + ' 到 ' + astText(e.args[1]);
        if (e.fn === '余数') return '余数 ' + astText(e.args[0]) + ' 除以 ' + astText(e.args[1]);
        return e.fn + ' ' + astText(e.args[0]);
    }
    return '?';
  }

  /* ======================= 语法高亮 ======================= */

  // 复用同一套词法规则做高亮，保证颜色永远和真实语法一致
  var KW_SET = {};
  HARD.forEach(function (k) { KW_SET[k] = 1; });
  var TYPE_HL = { '整型': 1, '浮点型': 1, '布尔型': 1, '字符型': 1, '字符串': 1, '数组': 1, '指针': 1, '文件': 1, '函数': 1 };
  var LIT_HL = { '真': 1, '假': 1 };

  function escHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function highlight(src) {
    var out = '';
    var i = 0, n = src.length;
    while (i < n) {
      var ch = src[i];

      // 注释
      if (ch === '#') {
        var j = i;
        while (j < n && src[j] !== '\n') j++;
        out += '<span class="hl-cmt">' + escHtml(src.slice(i, j)) + '</span>';
        i = j; continue;
      }

      // 字符串
      if (ch === '"' || ch === '“' || ch === '「') {
        var closeS = ch === '「' ? '」' : (ch === '“' ? '”' : '"');
        var k = i + 1;
        while (k < n && src[k] !== closeS && src[k] !== '\n') k++;
        if (src[k] === closeS) k++;
        out += '<span class="hl-str">' + escHtml(src.slice(i, k)) + '</span>';
        i = k; continue;
      }

      // 字符
      if (ch === "'" || ch === '‘') {
        var closeC = ch === '‘' ? '’' : "'";
        var kc = i + 1;
        while (kc < n && src[kc] !== closeC && src[kc] !== '\n') kc++;
        if (src[kc] === closeC) kc++;
        out += '<span class="hl-chr">' + escHtml(src.slice(i, kc)) + '</span>';
        i = kc; continue;
      }

      // 数字
      if (ch >= '0' && ch <= '9') {
        var kn = i;
        while (kn < n && ((src[kn] >= '0' && src[kn] <= '9') || src[kn] === '.')) kn++;
        out += '<span class="hl-num">' + escHtml(src.slice(i, kn)) + '</span>';
        i = kn; continue;
      }

      // 标识符 / 关键字 / 类型
      if (RE_ID_START.test(ch)) {
        var ki = i, id = '';
        while (ki < n && RE_ID_BODY.test(src[ki])) { id += src[ki]; ki++; }
        if (LIT_HL[id]) out += '<span class="hl-lit">' + escHtml(id) + '</span>';
        else if (TYPE_HL[id]) out += '<span class="hl-ty">' + escHtml(id) + '</span>';
        else if (KW_SET[id]) out += '<span class="hl-kw">' + escHtml(id) + '</span>';
        else out += escHtml(id);
        i = ki; continue;
      }

      // 符号
      if ('+-*/%&()[],'.indexOf(ch) >= 0) {
        out += '<span class="hl-op">' + escHtml(ch) + '</span>';
        i++; continue;
      }

      out += escHtml(ch);
      i++;
    }
    return out;
  }

  /* ======================= 对外接口 ======================= */

  function compile(src) { return parse(tokenize(src)); }

  function createRunner(src, options) {
    options = options || {};
    var ast = compile(src);

    var fs = options.fs || createFS();
    var addrNames = [];

    var ctx = {
      scope: new Scope(null, '全局'),
      output: [],
      pending: [],
      steps: 0,
      depth: 0,
      returnValue: null,
      fs: fs,
      rng: options.random || Math.random,
      ask: options.ask || function (p) {
        if (typeof prompt === 'function') { var r = prompt(p); return r === null ? '' : r; }
        return '';
      },
      addrOf: function (name) {
        var idx = addrNames.indexOf(name);
        if (idx < 0) { addrNames.push(name); idx = addrNames.length - 1; }
        return '0x' + (0x1000 + idx * 4).toString(16).toUpperCase();
      }
    };

    var gen = execBlock(ast, ctx, ctx.scope);
    var finished = false, last = null, failure = null;

    return {
      next: function () {
        if (finished) return { done: true, snapshot: null, error: null };
        try {
          var r = gen.next();
          if (r.done) { finished = true; return { done: true, snapshot: null, error: null }; }
          last = r.value;
          return { done: false, snapshot: r.value, error: null };
        } catch (e) {
          finished = true;
          failure = e;
          if (e instanceof LangError) return { done: true, snapshot: last, error: e };
          return { done: true, snapshot: last, error: new LangError('程序出错了：' + (e && e.message), 1) };
        }
      },
      runAll: function (limit) {
        limit = limit || MAX_STEPS;
        var snaps = [];
        for (var i = 0; i < limit; i++) {
          var r = this.next();
          if (r.snapshot) snaps.push(r.snapshot);
          if (r.done) return { snapshots: snaps, error: r.error, finished: true };
        }
        return { snapshots: snaps, error: null, finished: false };
      },
      isDone: function () { return finished; },
      getError: function () { return failure; },
      getFS: function () { return fs; }
    };
  }

  return {
    tokenize: tokenize,
    compile: compile,
    createRunner: createRunner,
    createFS: createFS,
    runAll: function (src, opts) { return createRunner(src, opts).runAll(); },
    LangError: LangError,
    fmt: fmt,
    astText: astText,
    highlight: highlight,
    MAX_STEPS: MAX_STEPS,
    TYPES: TYPES
  };
});
