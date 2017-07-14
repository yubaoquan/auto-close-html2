'use babel';

import { CompositeDisposable } from 'atom';
import config from './config';

const indexOf = [].indexOf || function(item) {
    for (var i = 0, l = this.length; i < l; i++) {
        if (i in this && this[i] === item) return i;
    }
    return -1;
};


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
    return config.selfCloseTags.some(tag => {
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
            description: 'Disabled autoclose in above file types'
        },
        selfCloseTags: {
            type: 'array',
            default: config.selfCloseTags,
            description: 'Selfclose tags, will not add the right part when type >'
        }
    },
    activate: function() {
        this.subscriptions = new CompositeDisposable();
        atom.config.observe('auto-close-html2.disabledFileExtensions', (value) => {
            this.disabledFileExtensions = value;
        });
        atom.config.observe('auto-close-html2.selfCloseTags', (val) => {
            config.selfCloseTags = val;
        });
        this.currentEditor = atom.workspace.getActiveTextEditor();
        if (this.currentEditor) {
            this.action = this.currentEditor.onDidInsertText((event) => {
                this._closeTag(event);
            });
        }
        this._getFileExtension();
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
        if (this.currentEditor.onDidInsertText) {
            return this.action = this.currentEditor.onDidInsertText(event => {
                return this._closeTag(event);
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
        while (!this.hasOddLeftBrackets(text) && rowNo > 0) {
            rowNo--;
            text = this.currentEditor.buffer.getLines()[rowNo] + text;
        }
        return text;
    },
    hasOddLeftBrackets(text) {
        const replaced = text.replace(/[^<]/g, '');
        return replaced.length % 2 !== 0;
    },
    _closeTag: function(event) {
        const ref = this.extension;
        if (
            this.disabledFileExtensions && indexOf.call(this.disabledFileExtensions, ref) >= 0
        ) {
            return;
        }
        const text = event.text;
        const range = event.range;
        if (text === '\n') {
            this._addIndent(event.range);
            return;
        }
        if (text !== '>' && text !== '/') {
            return;
        }
        let line = this.currentEditor.buffer.getLines()[range.end.row];
        line = line.slice(0, range.end.column - 1);
        // const strBefore = line.substr(0, range.start.column);
        const strBefore = this.getTextBefore(line, range.end.row);
        const strAfter = line.substr(range.end.column);
        const previousTagIndex = strBefore.lastIndexOf('<');
        if (previousTagIndex < 0) {
            return;
        }
        const ref1 = strBefore.match(/^.*\<([a-zA-Z-_.]+)[^>]*?/);
        let tagName;
        if (ref1) {
            tagName = ref1[1];
        }
        if (!tagName) {
            return;
        }
        if (isOpenedCondition(strBefore)) {
            return;
        }
        if (text === '>') {
            const tempBefore = trimRight(strBefore);
            if (tempBefore[tempBefore.length - 1] === '/') {
                return;
            }
            if (isSelfcloseTag(strBefore)) {
                this.currentEditor.backspace();
                return this.closeSelfTag(strBefore);
            }
            this.currentEditor.insertText(`</${tagName}>`);
            this.currentEditor.moveLeft(tagName.length + 3);
        } else if (text === '/') {
            if (strAfter[0] === '>' || hasOddQuots(strBefore)) {
                return;
            }
            this.currentEditor.backspace();
            this.closeSelfTag(strBefore);
        }
    },
    closeSelfTag(strBefore) {
        if (strBefore[strBefore.length - 1] === ' ') {
            this.currentEditor.insertText('/>');
        } else {
            this.currentEditor.insertText(' />');
        }
    },
};
