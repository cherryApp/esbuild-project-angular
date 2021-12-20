import { Pipe, PipeTransform } from '@angular/core';

@Pipe({
  name: 'filter'
})
export class FilterPipe implements PipeTransform {

  transform(value: any[], ...args: unknown[]): any[] | null {
    if (!Array.isArray(value)) {
      return value;
    }

    return value.filter( item => {
      return item.name === 'Pisti';
    });
  }

}
