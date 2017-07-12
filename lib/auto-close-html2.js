'use babel';
const indexOf = [].indexOf || function(item) {
    for (var i = 0, l = this.length; i < l; i++) {
        if (i in this && this[i] === item) return i;
    }
    return -1;
};

import { CompositeDisposable } from 'atom';

function hasOddQuots(str) {
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

function trimRight(str) {
    return str.replace(/\s+$/, '');
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
        }
    },
    activate: function() {
        this.subscriptions = new CompositeDisposable();
        atom.config.observe('autoclose.disabledFileExtensions', (value) => {
            this.disabledFileExtensions = value;
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
        if (ref != null && typeof ref.getFileName === 'function') {
            filename = ref.getFileName();
        }
        return this.extension = filename != null ? filename.substr((filename != null ? filename.lastIndexOf('.') : undefined) + 1) : undefined;
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
            return this.action = this.currentEditor.onDidInsertText((function(_this) {
                return function(event) {
                    return _this._closeTag(event);
                };
            })(this));
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
        const line = this.currentEditor.buffer.getLines()[range.end.row];
        const strBefore = line.substr(0, range.start.column);
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
        if (text === '>') {
            const tempBefore = trimRight(strBefore);
            if (tempBefore[tempBefore.length - 1] === '/') {
                return;
            }
            this.currentEditor.insertText(`</${tagName}>`);
            this.currentEditor.moveLeft(tagName.length + 3);
        } else if (text === '/') {
            if (strAfter[0] === '>' || hasOddQuots(strBefore)) {
                return;
            }
            this.currentEditor.insertText('>');
        }
    }
};
