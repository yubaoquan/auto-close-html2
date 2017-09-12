'use babel';
/* globals atom */
import { CompositeDisposable } from 'atom';
import config from './config';

function hasOddQuots(str = '') {
    const singleQuots = str.match(/'/g);
    const doubleQuots = str.match(/"/g);
    let ret = 0;
    if (singleQuots) {
        ret += singleQuots.length;
    }
    if (doubleQuots) {
        ret += doubleQuots.length;
    }
    return ret % 2 === 1;
}

function trimRight(str = '') {
    return str.replace(/\s+$/, '');
}

function isSelfcloseTag(str = '') {
    const tagName = findTagName(str);
    if (!tagName || !tagName.toLowerCase()) {
        return;
    }
    return config.selfCloseTags.some((tag) => {
        return tag.toLowerCase() === tagName;
    });
}

function findTagName(str = '') {
    const tokens = str.split('<');
    if (!tokens.length) {
        return '';
    }
    const currentTagLeft = tokens[tokens.length - 1];
    const currentTagName = currentTagLeft.split(' ')[0];
    return currentTagName && currentTagName.toLowerCase();
}

function isOpenedCondition(str) {
    return /{[^}]*$/.test(str);
}
export default {
    subscriptions: null,
    currentEditor: null,
    action: null,
    extension: '',
    disabledFileExtensions: [],
    config: {
        disabledFileExtensions: {
            type: 'array',
            default: ['js', 'jsx'],
            description: 'Disabled autoclose in above file types',
        },
        selfCloseTags: {
            type: 'array',
            default: config.selfCloseTags,
            description: 'Self-close tags, will not add the right part when type >',
        },
        slashTriggerAutoClose: {
            type: 'boolean',
            default: config.slashTriggerAutoClose,
            description: 'Trigger auto close when type a slash /',
        },
        addSlashToSelfCloseTag: {
            type: 'boolean',
            default: config.addSlashToSelfCloseTag,
            description: 'Automatically add a slash when close the self-close tag',
        },
        insertWhitespaceOnClose: {
            type: 'boolean',
            default: config.insertWhitespaceOnClose,
            description: 'Add a whitespace before > when close the self-close tag',
        },
    },
    observeConfig(packageName, configKeys = []) {
        configKeys.forEach((item) => {
            atom.config.observe(`${packageName}.${item}`, (val) => {
                if (val == null) {
                    return;
                }
                config[item] = val;
            });
        });
    },
    activate: function() {
        this.subscriptions = new CompositeDisposable();
        this.observeConfig('auto-close-html2', [
            'disabledFileExtensions',
            'selfCloseTags',
            'addSlashToSelfCloseTag',
            'slashTriggerAutoClose',
            'insertWhitespaceOnClose',
        ]);
        this._getFileExtension();
        if (this.autocloseDisabled()) {
            return;
        }
        this.currentEditor = atom.workspace.getActiveTextEditor();
        if (this.currentEditor) {
            this.action = this.currentEditor.onDidInsertText((event) => {
                this._closeTag(event);
            });
        }
        atom.workspace.onDidChangeActivePaneItem((paneItem) => {
            this._paneItemChanged(paneItem);
        });
    },
    deactivate: function() {
        if (this.action) {
            this.action.disposalAction();
        }
        return this.subscriptions.dispose();
    },
    _getFileExtension: function() {
        let filename;
        const ref = this.currentEditor;
        if (ref && typeof ref.getFileName === 'function') {
            filename = ref.getFileName();
        }
        this.extension = undefined;
        if (filename && filename.includes('.')) {
            const parts = filename.split('.');
            this.extension = parts[parts.length - 1];
        }
        return this.extension;
    },
    _paneItemChanged: function(paneItem) {
        if (!paneItem) {
            return;
        }
        if (this.action) {
            this.action.disposalAction();
        }
        this.currentEditor = paneItem;
        this._getFileExtension();
        if (this.autocloseDisabled()) {
            return;
        }
        if (this.currentEditor.onDidInsertText) {
            this.action = this.currentEditor.onDidInsertText((event) => {
                this._closeTag(event);
            });
        }
    },
    _addIndent: function(range) {
        const start = range.start;
        const end = range.end;
        const buffer = this.currentEditor.buffer;
        const lineBefore = buffer.getLines()[start.row];
        const lineAfter = buffer.getLines()[end.row];
        const content = lineBefore.substr(lineBefore.lastIndexOf('<')) + '\n' + lineAfter;
        const regex = /^.*\<([a-zA-Z-_]+)(\s.+)?\>\n\s*\<\/\1\>.*/;
        if (regex.test(content)) {
            this.currentEditor.insertNewlineAbove();
            return this.currentEditor.insertText('  ');
        }
        const attrNewLineReg = /^.*\<([a-zA-Z-_]+)[^>]*\n\s*[^>]*$/;
        if (attrNewLineReg.test(content)) {
            this.currentEditor.insertText('    ');
        }
    },
    getTextBefore(text, rowNo) {
        let multiRow = false;
        while (!this.hasOddLeftBrackets(text) && rowNo > 0) {
            rowNo--;
            multiRow = true;
            text = this.currentEditor.buffer.getLines()[rowNo] + text;
        }
        return { str: text, multiRow };
    },
    hasOddLeftBrackets(text) {
        const replaced = text.replace(/[^<]/g, '');
        return replaced.length % 2 !== 0;
    },
    autocloseDisabled() {
        const extensions = config.disabledFileExtensions;
        return extensions && extensions.includes(this.extension);
    },
    _closeTag: function(event) {
        const text = event.text;
        const range = event.range;
        if (text === '\n') {
            this._addIndent(event.range);
            return;
        }
        if (!['>', '/', '!'].includes(text)) {
            return;
        }
        const line = this.currentEditor.buffer.getLines()[range.end.row];
        const lineLeft = line.slice(0, range.end.column - 1);
        const { str, multiRow } = this.getTextBefore(lineLeft, range.end.row);
        const strBefore = str;
        let indentSize = 0;

        if (multiRow) {
            indentSize = strBefore.match(/^\s*/)[0].length;
        }

        const tagName = this.getTagName(strBefore);

        if (text === '!') {
            return this.dealExclamationMark(range, strBefore);
        }

        if (!tagName || isOpenedCondition(strBefore)) {
            return;
        }
        if (text === '>') {
            this.dealRightAngleBracket(
                range,
                strBefore,
                indentSize,
                tagName,
            );
        } else if (text === '/' && config.slashTriggerAutoClose) {
            this.dealSlash(range, strBefore, indentSize);
        }
    },
    getTagName(str) {
        if (str.includes('<')) {
            const matchResult = str.match(/^.*\<([a-zA-Z-_.#]+)[^>]*?/);
            return matchResult && matchResult[1];
        }
    },
    /**
     * when user sype /
     *
     * @param  {string}   strBefore  [ string before the current charactor / ]
     * @param  {number}   indentSize [ the indent size of the tag beginning part ]
     */
    dealSlash(range, strBefore, indentSize) {
        const line = this.currentEditor.buffer.getLines()[range.end.row];
        this.backspaceIfNeeded(range, strBefore, indentSize);
        if (
            line.substr(range.end.column, 1) === '>' ||
            hasOddQuots(strBefore)
        ) {
            return;
        }
        this.currentEditor.backspace();
        this.closeSelfTag(strBefore);
    },
    /**
     * when user type >
     *
     * @param  {string}   strBefore  [ string before the current charactor > ]
     * @param  {number}   indentSize [ the indent size of the tag beginning part ]
     */
    dealRightAngleBracket(range, strBefore, indentSize, tagName) {
        const tempBefore = trimRight(strBefore);
        if (tempBefore[tempBefore.length - 1] === '/') {
            return;
        }
        this.backspaceIfNeeded(range, strBefore, indentSize);
        if (isSelfcloseTag(strBefore)) {
            this.currentEditor.backspace();
            return this.closeSelfTag(strBefore);
        }
        this.currentEditor.insertText(`</${tagName}>`);
        this.currentEditor.moveLeft(tagName.length + 3);
    },
    dealExclamationMark(range, strBefore) {
        if (range.end.row === 0) {
            return;
            // <!DOCTYPE html>
        }
        if (/<$/.test(strBefore)) {
            this.currentEditor.insertText(`--  -->`);
            const rightPartLen = ' -->'.length;
            this.currentEditor.moveLeft(rightPartLen);
        }
    },
    backspaceIfNeeded(range, strBefore, indentSize) {
        if (this.endsWithSpaces(strBefore, indentSize)) {
            this.backIndent(range, indentSize);
        }
    },
    backIndent(range, indentSize) {
        if (!indentSize) {
            return;
        }
        const backDistance = range.end.column - indentSize - 1;
        if (backDistance) {
            this.currentEditor.moveLeft(1);
            this.currentEditor.backspace();
            this.currentEditor.moveRight(1);
        }
    },
    endsWithSpaces(leftPart, indentSize) {
        let expectedStr = '';
        for (let i = 0; i < indentSize; i++) {
            expectedStr += ' ';
        }
        return expectedStr === leftPart.slice(leftPart.length - indentSize);
    },
    closeSelfTag(strBefore) {
        let closePart = '>';
        if (config.addSlashToSelfCloseTag) {
            closePart = '/>';
        }
        if (strBefore[strBefore.length - 1] === ' ') {
            return this.currentEditor.insertText(closePart);
        }
        if (config.insertWhitespaceOnClose) {
            return this.currentEditor.insertText(' ' + closePart);
        }
        this.currentEditor.insertText(closePart + ' ');
        this.currentEditor.backspace();
    },
};
