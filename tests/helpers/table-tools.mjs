export async function tableAction(root,name){
 const action=root.getByRole('button',{name,exact:true})
 if(!await action.isVisible())await root.getByRole('button',{name:'更多操作',exact:true}).click()
 await action.click()
}
