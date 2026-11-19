from pathlib import Path
from pptx import Presentation
from pptx.util import Inches,Pt
from pptx.dml.color import RGBColor
from pptx.oxml.xmlchemy import OxmlElement
root=Path(__file__).resolve().parent;root.mkdir(parents=True,exist_ok=True)
p=Presentation();p.slide_width=Inches(12.8);p.slide_height=Inches(7.2)
cases=['Normal fixed rows','Wrapped long text grows row','Large frame, small grid','Small frame, tall grid','Vertical merged cell','Horizontal merged cell','CJK mixed text','Grouped table','Rotated table','Unequal row heights']
long='A table row must grow with its wrapped text. The complete content remains visible and the following rows keep their order. '
for i,title in enumerate(cases):
 s=p.slides.add_slide(p.slide_layouts[6]);box=s.shapes.add_textbox(Inches(.6),Inches(.3),Inches(11),Inches(.6));box.text=title;box.text_frame.paragraphs[0].font.size=Pt(26)
 frame=s.shapes.add_table(3,2,Inches(1),Inches(1.3),Inches(10),Inches(2.4));table=frame.table;table.columns[0].width=Inches(2.3);table.columns[1].width=Inches(7.7)
 for row in range(3):
  table.cell(row,0).text=['FIRST','SECOND','THIRD'][row];table.cell(row,1).text='Row '+str(row+1)+' complete text.'
 if i in [1,2]:
  table.cell(0,1).text=long*3
  for row in table.rows:row.height=Inches(.32)
 if i==2:frame._element.find('.//{http://schemas.openxmlformats.org/presentationml/2006/main}xfrm/{http://schemas.openxmlformats.org/drawingml/2006/main}ext').set('cy',str(Inches(5.3)))
 if i==3:
  for row in table.rows:row.height=Inches(1)
  frame._element.find('.//{http://schemas.openxmlformats.org/presentationml/2006/main}xfrm/{http://schemas.openxmlformats.org/drawingml/2006/main}ext').set('cy',str(Inches(.3)))
 if i==4:table.cell(0,1).merge(table.cell(1,1));table.cell(0,1).text=long*3
 if i==5:table.cell(0,0).merge(table.cell(0,1));table.cell(0,0).text=long*2
 if i==6:table.cell(0,1).text='中英文混排需要在真实列宽内换行，保留完整段落。A mixed language paragraph must remain readable. '*5
 for row in table.rows:
  for cell in row.cells:
   cell.margin_left=Inches(.1);cell.margin_right=Inches(.1);cell.margin_top=Inches(.05);cell.margin_bottom=Inches(.05)
   for para in cell.text_frame.paragraphs:para.font.name='Arial';para.font.size=Pt(15);para.font.color.rgb=RGBColor(25,45,35)
 if i==8:frame.rotation=12
 if i==9:
  for row,height in zip(table.rows,[.45,1.25,.65]):row.height=Inches(height)
  table.cell(1,1).text=long*2
 if i==7:
  grp=OxmlElement('p:grpSp');nv=OxmlElement('p:nvGrpSpPr');pr=OxmlElement('p:cNvPr');pr.set('id','99');pr.set('name','Grouped table');nv.append(pr);nv.append(OxmlElement('p:cNvGrpSpPr'));nv.append(OxmlElement('p:nvPr'));grp.append(nv);sp=OxmlElement('p:grpSpPr');xf=OxmlElement('a:xfrm')
  for tag,attrs in [('off',{'x':str(Inches(.5)),'y':str(Inches(.8))}),('ext',{'cx':str(Inches(10.24)),'cy':str(Inches(5.76))}),('chOff',{'x':'0','y':'0'}),('chExt',{'cx':str(Inches(12.8)),'cy':str(Inches(7.2))})]:
   n=OxmlElement('a:'+tag)
   for k,v in attrs.items():n.set(k,v)
   xf.append(n)
  sp.append(xf);grp.append(sp);grp.append(frame._element);s.shapes._spTree.append(grp)
p.save(root/'table-layout.pptx');print('Created 10 independent table layout cases')
