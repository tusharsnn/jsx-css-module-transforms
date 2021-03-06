import type { NodePath, PluginObj, types as t } from "@babel/core"
import type babel from "@babel/core"
import chalk from "chalk"

import { getImportInfo, getTemplFromStrCls } from "./transforms"
import { CSSModuleError } from "./utils"

const API = function ({ types: t }: typeof babel): PluginObj<PluginPass> {
    function pre(this: PluginPass): void {
        this.pluginState = {
            modules: {
                namedModules: {},
            },
        }
    }

    let ImportDeclaration = (path: NodePath<t.ImportDeclaration>, state: PluginPass) => {
        // stores previous css-modules found on the same file
        let modules: Modules = state.pluginState.modules ?? { namedModules: {} }

        if (!t.isImportDeclaration(path.node) || !/.module.(s[ac]ss|css)(:.*)?$/iu.test(path.node.source.value)) return

        // saving path for error messages
        CSSModuleError.path = path

        if (path.node.specifiers.length > 1 && !t.isImportDefaultSpecifier(path.node.specifiers[0])) {
            // eg. import {classA, classB } from "./m1.module.css"
            throw new CSSModuleError(`import css-module as a default import on '${chalk.cyan(path.node.source.value)}'`)
        }

        if (path.node.specifiers.length > 1) {
            // eg. import style, {classA, classB} from "./m1.module.css"
            throw new CSSModuleError(`more than one import found on '${chalk.cyan(path.node.source.value)}'`)
        }

        let importSpecifier: t.Identifier,
            newSpecifiers: (t.ImportSpecifier | t.ImportDefaultSpecifier)[],
            newImportDeclaration: t.ImportDeclaration,
            moduleInfo = getImportInfo(path.node)

        if (moduleInfo.hasSpecifier) {
            importSpecifier = path.node.specifiers[0].local
            if (importSpecifier.name in state.pluginState.modules.namedModules) {
                throw new CSSModuleError(
                    `CSS-Module ${chalk.yellow(`'${importSpecifier.name}'`)}  has already been declared`
                )
            }

            // saving new module
            state.pluginState.modules.namedModules[importSpecifier.name] = importSpecifier.name
        } else if (moduleInfo.default) {
            if (modules.defaultModule) {
                throw new CSSModuleError(
                    `only one default css-module import is allowed. provide names for all except the default module`
                )
            }

            importSpecifier = path.scope.generateUidIdentifier("style")
            newSpecifiers = [t.importDefaultSpecifier(importSpecifier)]
            newImportDeclaration = t.importDeclaration(newSpecifiers, t.stringLiteral(path.node.source.value))
            path.replaceWith<t.ImportDeclaration>(newImportDeclaration)
            path.skip()

            // saving new module
            state.pluginState.modules.defaultModule = importSpecifier.name
        } else {
            if (moduleInfo.moduleName in state.pluginState.modules.namedModules) {
                throw new CSSModuleError(
                    `CSS-Module ${chalk.yellow(`'${moduleInfo.moduleName}'`)} has already been declared`
                )
            }
            importSpecifier = path.scope.generateUidIdentifier(moduleInfo.moduleName)
            newSpecifiers = [t.importDefaultSpecifier(importSpecifier)]
            newImportDeclaration = t.importDeclaration(newSpecifiers, t.stringLiteral(path.node.source.value))
            path.replaceWith<t.ImportDeclaration>(newImportDeclaration)
            path.skip()

            // saving new module
            state.pluginState.modules.namedModules[moduleInfo.moduleName] = importSpecifier.name
        }

        // strips away module name from the source
        path.node.source.value = moduleInfo.moduleSource // this inplace replacment does not causes any problem with the ast
    }

    let JSXAttribute = (path: NodePath<t.JSXAttribute>, state: PluginPass) => {
        let firstNamedModule = getFirstNamedModule(state.pluginState.modules.namedModules)

        if (path.node.name.name != "className" || (!state.pluginState.modules.defaultModule && !firstNamedModule)) {
            return
        }

        // saving path for error messages
        CSSModuleError.path = path

        // if no default modules is available, make the first modules as default
        if (!state.pluginState.modules.defaultModule && firstNamedModule) {
            state.pluginState.modules.defaultModule = state.pluginState.modules.namedModules[firstNamedModule]
        }

        let fileCSSModules = state.pluginState.modules

        // string case
        if (t.isStringLiteral(path.node.value)) {
            let templateLiteral = getTemplFromStrCls(path.node.value.value, fileCSSModules)
            let jsxExpressionContainer = t.jsxExpressionContainer(templateLiteral)
            let newJSXAttr = t.jsxAttribute(t.jsxIdentifier("className"), jsxExpressionContainer)
            path.replaceWith<t.JSXAttribute>(newJSXAttr)
            path.skip()
        }
    }

    return {
        pre,
        visitor: {
            ImportDeclaration,
            JSXAttribute,
        },
    }
}

export default API

function getFirstNamedModule(namedModules: Modules["namedModules"]): string | null {
    for (let module in namedModules) return module
    return null
}

export type Modules = {
    defaultModule?: string
    namedModules: { [moduleName: string]: string }
}

type PluginState = {
    modules: Modules
}

interface PluginPass extends babel.PluginPass {
    pluginState: PluginState
}
